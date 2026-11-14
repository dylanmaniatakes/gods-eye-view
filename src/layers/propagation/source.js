import { readResponseJsonCapped } from '../../sources/httpBody.js';
import { msg } from '../../i18n/marker.js';
import {
  PROPAGATION_BANDS,
  PROPAGATION_MAX_PATHS,
  normalizePropagationReport,
  mergePropagationPath,
  prunePropagationPaths,
} from './records.js';

const WSPR_URL = 'https://db1.wspr.live/';
const MQTT_URL = 'wss://mqtt.pskreporter.info:1886/mqtt';
const VHF_TOPIC = 'pskr/filter/v2/2m/#';

/** Fixed, time-and-band-filtered WSPR query with a balanced per-band path cap. */
export function propagationQuery(bands) {
  const codes = PROPAGATION_BANDS.filter((band) => bands.includes(band.id)).map(
    (band) => band.wspr,
  );
  if (!codes.length)
    throw new TypeError('A supported propagation band is required');
  return `SELECT band, tx_sign, tx_loc, rx_sign, rx_loc, max(toUnixTimestamp(time)) AS observed, argMax(snr, time) AS snr, argMax(frequency, time) AS frequency, count() AS reports FROM wspr.rx WHERE time >= now() - INTERVAL 30 MINUTE AND time <= now() AND band IN (${codes.join(',')}) GROUP BY band, tx_sign, tx_loc, rx_sign, rx_loc ORDER BY band, cityHash64(tx_loc, rx_loc) LIMIT 300 BY band LIMIT 1500 FORMAT JSON`;
}

/** Fetch an explicitly sampled 30-minute snapshot using WSPR Live's public API. */
export function createWsprPropagationSource({
  bands = ['10m', '20m', '40m', '80m', '160m'],
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
} = {}) {
  const url = new URL(WSPR_URL);
  url.searchParams.set('query', propagationQuery(bands));
  let cached = null;
  return {
    label: 'WSPR Live', // i18n-ignore: provider's proper name
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      if (cached && now() - cached.fetchedAt < 120000) return cached;
      const deadline = AbortSignal.timeout(20000);
      const requestSignal = signal
        ? AbortSignal.any([signal, deadline])
        : deadline;
      const response = await fetchImpl(url.href, {
        signal: requestSignal,
        credentials: 'omit',
      });
      if (!response.ok) throw new Error(`WSPR Live HTTP ${response.status}`);
      const payload = await readResponseJsonCapped(
        response,
        2 * 1024 * 1024,
        requestSignal,
      );
      if (
        !Array.isArray(payload?.data) ||
        payload.data.length > PROPAGATION_MAX_PATHS
      )
        throw new Error(msg('Invalid propagation response'));
      const fetchedAt = now();
      const rows = payload.data
        .map((row) =>
          normalizePropagationReport(
            {
              band: PROPAGATION_BANDS.find((band) => band.wspr === row.band)
                ?.id,
              tx: row.tx_sign,
              txGrid: row.tx_loc,
              rx: row.rx_sign,
              rxGrid: row.rx_loc,
              observedAt: Number(row.observed) * 1000,
              frequencyHz: Number(row.frequency),
              snrDb: row.snr,
              reports: Number(row.reports),
              source: 'WSPR Live',
            },
            fetchedAt,
          ),
        )
        .filter((row) => row && bands.includes(row.band));
      requestSignal.throwIfAborted();
      cached = {
        rows,
        fetchedAt,
        sampled: true,
        connected: false,
        bootstrapOnly: true,
      };
      return cached;
    },
  };
}

/**
 * Live 2 m reception reports, seeded by WSPR for an immediate initial picture.
 * The owning layer's lifetime signal closes MQTT immediately on disable.
 */
export function createVhfPropagationSource({
  loadMqtt = () => import('mqtt'),
  seed = createWsprPropagationSource({ bands: ['2m'] }),
  now = () => Date.now(),
} = {}) {
  const paths = new Map();
  let session = null;
  let connected = false;
  let streamError = null;
  let seedError = null;
  let seeded = false;
  let startedAt = null;
  let truncated = false;
  let lastMessageAt = null;
  return {
    label: 'PSK Reporter · WSPR Live', // i18n-ignore: providers' proper names
    start({ signal }) {
      signal.throwIfAborted();
      const current = {};
      session = current;
      connected = false;
      streamError = null;
      seedError = null;
      seeded = false;
      startedAt = now();
      paths.clear();
      truncated = false;
      lastMessageAt = null;
      const stop = () => {
        current.client?.end(true);
        if (session === current) {
          session = null;
          connected = false;
          paths.clear();
        }
      };
      signal.addEventListener('abort', stop, { once: true });
      void seed
        .getSnapshot({ signal })
        .then((snapshot) => {
          if (signal.aborted || session !== current) return;
          for (const row of snapshot.rows) mergePropagationPath(paths, row);
          prunePropagationPaths(paths, now());
          seeded = true;
        })
        .catch(() => {
          if (!signal.aborted && session === current) seedError = true;
        });
      void loadMqtt()
        .then((module) => {
          if (signal.aborted || session !== current) return;
          const connect = module.connect || module.default?.connect;
          const client = connect(MQTT_URL, {
            clean: true,
            protocolVersion: 4,
            keepalive: 60,
            connectTimeout: 15000,
            reconnectPeriod: 15000,
            resubscribe: false,
            queueQoSZero: false,
          });
          current.client = client;
          client.on('connect', () => {
            if (signal.aborted || session !== current) return;
            client.subscribe(VHF_TOPIC, { qos: 0 }, (error, granted) => {
              if (signal.aborted || session !== current) return;
              connected =
                !error && granted?.some((grant) => grant.qos < 128) === true;
              streamError = connected ? null : true;
            });
          });
          client.on('message', (topic, bytes) => {
            if (
              signal.aborted ||
              session !== current ||
              !topic.startsWith('pskr/filter/v2/2m/') ||
              bytes.length > 8192
            )
              return;
            try {
              const spot = JSON.parse(bytes.toString());
              const row = normalizePropagationReport(
                {
                  band: spot.b,
                  tx: spot.sc,
                  txGrid: spot.sl,
                  rx: spot.rc,
                  rxGrid: spot.rl,
                  observedAt: (spot.t_tx ?? spot.t) * 1000,
                  frequencyHz: spot.f,
                  snrDb: spot.rp,
                  mode: spot.md,
                  source: 'PSK Reporter',
                },
                now(),
              );
              if (row?.band !== '2m') return;
              mergePropagationPath(paths, row);
              truncated ||= paths.size > PROPAGATION_MAX_PATHS;
              prunePropagationPaths(paths, now());
              lastMessageAt = now();
            } catch {
              /* Invalid upstream messages do not break the subscription. */
            }
          });
          client.on('error', () => {
            if (session === current && !signal.aborted) streamError = true;
          });
          client.on('close', () => {
            if (session === current && !signal.aborted) {
              connected = false;
              streamError = true;
            }
          });
        })
        .catch(() => {
          if (!signal.aborted && session === current) streamError = true;
        });
    },
    getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();
      prunePropagationPaths(paths, now());
      return {
        rows: [...paths.values()],
        fetchedAt: now(),
        sampled: true,
        connected,
        startedAt,
        lastMessageAt,
        truncated,
        seeded,
        degraded: Boolean(streamError || seedError),
        waiting: !connected && !streamError,
        streamUnavailable: Boolean(streamError),
      };
    },
  };
}
