import * as Cesium from 'cesium';
import { formatNumber, msg, t } from '../../i18n/index.js';
import {
  PROPAGATION_BANDS,
  PROPAGATION_WINDOW_MS,
  PROPAGATION_MAX_PATHS,
} from './records.js';
export {
  createWsprPropagationSource,
  createVhfPropagationSource,
} from './source.js';

const HF_BANDS = PROPAGATION_BANDS.filter((band) => band.id !== '2m');
const HF_NOTICE = msg(
  'Reception reports are samples, not guaranteed coverage. No reports does not mean a closed band.',
);
const VHF_NOTICE = msg(
  'Long 2 m paths may indicate an opening; they do not confirm ducting. Antenna, terrain and other propagation modes affect range.',
);

/** Build an illustrative short great-circle arc, not a reconstructed RF ray. */
export function propagationArc(row, vhf = false) {
  const start = Cesium.Cartographic.fromDegrees(row.from.lon, row.from.lat);
  const end = Cesium.Cartographic.fromDegrees(row.to.lon, row.to.lat);
  // Vincenty's inverse solution is undefined near antipodes. The spherical
  // geodesic is used only for display and works across the date line and poles.
  const a = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.fromRadians(
      start.longitude,
      start.latitude,
      0,
      Cesium.Ellipsoid.UNIT_SPHERE,
    ),
    new Cesium.Cartesian3(),
  );
  const b = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.fromRadians(
      end.longitude,
      end.latitude,
      0,
      Cesium.Ellipsoid.UNIT_SPHERE,
    ),
    new Cesium.Cartesian3(),
  );
  const angle = Math.acos(
    Cesium.Math.clamp(Cesium.Cartesian3.dot(a, b), -1, 1),
  );
  let normal = Cesium.Cartesian3.cross(a, b, new Cesium.Cartesian3());
  if (Cesium.Cartesian3.magnitudeSquared(normal) < 1e-12)
    normal = Cesium.Cartesian3.cross(
      a,
      Cesium.Cartesian3.mostOrthogonalAxis(a, new Cesium.Cartesian3()),
      normal,
    );
  Cesium.Cartesian3.normalize(normal, normal);
  const tangent = Cesium.Cartesian3.cross(normal, a, new Cesium.Cartesian3());
  const height = vhf
    ? Math.min(18000, row.distanceKm * 30)
    : Math.min(180000, row.distanceKm * 35);
  return Array.from({ length: 33 }, (_, index) => {
    const f = index / 32;
    const vector = Cesium.Cartesian3.add(
      Cesium.Cartesian3.multiplyByScalar(
        a,
        Math.cos(angle * f),
        new Cesium.Cartesian3(),
      ),
      Cesium.Cartesian3.multiplyByScalar(
        tangent,
        Math.sin(angle * f),
        new Cesium.Cartesian3(),
      ),
      new Cesium.Cartesian3(),
    );
    const point = Cesium.Cartographic.fromCartesian(
      vector,
      Cesium.Ellipsoid.UNIT_SPHERE,
    );
    return Cesium.Cartesian3.fromRadians(
      point.longitude,
      point.latitude,
      1500 + height * Math.sin(Math.PI * f),
    );
  });
}

/** Own one bounded, off-by-default observed propagation display and its controls. */
export function createPropagationLayer({
  source,
  vhf = false,
  now = () => Date.now(),
} = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Propagation requires a snapshot source');
  const id = vhf ? 'vhf-propagation' : 'hf-propagation';
  let viewer = null,
    dataSource = null,
    enabled = false,
    lifetime = null,
    request = null;
  let rows = [],
    snapshot = null,
    error = null,
    lastUpdate = null,
    listener = null,
    signature = null;
  const params = vhf
    ? { longPathsOnly: false }
    : Object.fromEntries(HF_BANDS.map((band) => [`band${band.id}`, true]));

  function freshRows() {
    return rows.filter(
      (row) => row.observedAt >= now() - PROPAGATION_WINDOW_MS,
    );
  }
  function visibleRows() {
    return freshRows().filter((row) =>
      vhf
        ? row.band === '2m' && (!params.longPathsOnly || row.distanceKm >= 300)
        : params[`band${row.band}`],
    );
  }
  function render() {
    if (!dataSource || !enabled) return;
    const visible = visibleRows();
    const nextSignature = JSON.stringify([
      Math.floor(now() / 60000),
      visible.map((row) => [row.id, row.observedAt, row.snrDb]),
    ]);
    if (signature === nextSignature) return;
    signature = nextSignature;
    const keep = new Set();
    dataSource.entities.suspendEvents();
    try {
      for (const row of visible) {
        const entityId = `${id}:${row.id}`;
        keep.add(entityId);
        let entity = dataSource.entities.getById(entityId);
        const colorText = vhf
          ? row.distanceKm >= 800
            ? '#ff7eaa'
            : row.distanceKm >= 300
              ? '#ffb454'
              : '#55e2be'
          : PROPAGATION_BANDS.find((band) => band.id === row.band).color;
        const opacity =
          0.85 -
          Math.min(
            1,
            Math.max(0, (now() - row.observedAt) / PROPAGATION_WINDOW_MS),
          ) *
            0.6;
        const color =
          Cesium.Color.fromCssColorString(colorText).withAlpha(opacity);
        if (!entity) {
          const positions = propagationArc(row, vhf);
          entity = dataSource.entities.add({
            id: entityId,
            name: `${row.tx} → ${row.rx} · ${row.band}`,
            position: positions[16],
            polyline: {
              positions,
              width: vhf ? 2.5 : 1.4,
              arcType: Cesium.ArcType.NONE,
              material: color,
            },
          });
        } else
          entity.polyline.material = new Cesium.ColorMaterialProperty(color);
        // Generic OBJECT DETAILS reads these public source fields on selection.
        entity.properties = {
          source: row.source,
          band: row.band,
          transmitter: row.tx,
          receiver: row.rx,
          transmitterGrid: row.from.grid,
          receiverGrid: row.to.grid,
          frequencyMHz: row.frequencyHz / 1e6,
          distanceKm: Math.round(row.distanceKm),
          snrDb: row.snrDb,
          observedUtc: new Date(row.observedAt).toISOString(),
          mode: row.mode,
          notice: t(vhf ? VHF_NOTICE : HF_NOTICE),
          geometry: t(
            'Illustrative great-circle connections; positions are grid centers.',
          ),
        };
      }
      for (const entity of [...dataSource.entities.values])
        if (!keep.has(entity.id)) dataSource.entities.remove(entity);
    } finally {
      dataSource.entities.resumeEvents();
    }
    viewer?.scene?.requestRender?.();
  }

  const layer = {
    id,
    name: vhf ? 'VHF Propagation (2 m)' : 'HF Propagation',
    icon: '⌁',
    source: vhf ? 'PSK Reporter · WSPR Live' : 'WSPR Live',
    updateInterval: vhf ? 10000 : 60000,
    init(host) {
      if (viewer) throw new Error('Propagation layer already initialized');
      viewer = host;
      dataSource = new Cesium.CustomDataSource(id);
      dataSource.show = false;
      host.dataSources.add(dataSource);
    },
    enable() {
      if (enabled) return;
      enabled = true;
      lifetime = new AbortController();
      dataSource.show = true;
      error = null;
      signature = null;
      if (source.start) {
        rows = [];
        snapshot = null;
        source.start({ signal: lifetime.signal });
      }
      render();
    },
    disable() {
      enabled = false;
      lifetime?.abort();
      lifetime = null;
      request?.abort();
      request = null;
      if (dataSource) {
        dataSource.show = false;
        dataSource.entities.removeAll();
      }
      signature = null;
    },
    async update(_time, { signal } = {}) {
      if (!enabled || !dataSource) return false;
      request?.abort();
      const current = new AbortController();
      request = current;
      const signals = [current.signal, lifetime.signal];
      if (signal) signals.push(signal);
      const requestSignal = AbortSignal.any(signals);
      try {
        const next = await source.getSnapshot({ signal: requestSignal });
        if (requestSignal.aborted || request !== current || !enabled)
          return false;
        if (!Array.isArray(next?.rows))
          throw new Error(msg('Invalid propagation response'));
        snapshot = next;
        rows = next.rows.slice(0, PROPAGATION_MAX_PATHS);
        lastUpdate = next.fetchedAt;
        error = null;
        render();
        listener?.();
        return true;
      } catch (cause) {
        if (requestSignal.aborted || request !== current || !enabled)
          return false;
        error = msg('Propagation source unavailable');
        render();
        listener?.();
        return false;
      } finally {
        if (request === current) request = null;
      }
    },
    destroy() {
      layer.disable();
      if (dataSource) viewer?.dataSources.remove(dataSource, true);
      dataSource = null;
      viewer = null;
      rows = [];
      snapshot = null;
      listener = null;
    },
    getParams() {
      return { ...params };
    },
    setParams(next) {
      for (const key of Object.keys(params))
        if (typeof next?.[key] === 'boolean') params[key] = next[key];
      signature = null;
      render();
      listener?.();
    },
    setRowControlsListener(next) {
      listener = next;
    },
    getRowControls() {
      const visible = visibleRows();
      const longest = visible.reduce(
        (distance, row) => Math.max(distance, row.distanceKm),
        0,
      );
      const status =
        vhf && snapshot?.streamUnavailable
          ? t(
              'PSK Reporter disconnected; showing available WSPR / recent reports',
            )
          : vhf && !visible.length
            ? t('Listening for 2 m reception reports…')
            : t('{shown} paths · longest {distance} km', {
                shown: formatNumber(visible.length),
                distance: formatNumber(Math.round(longest)),
              });
      return {
        chips: vhf
          ? [
              {
                id: 'all',
                label: t('All'),
                active: !params.longPathsOnly,
                params: { longPathsOnly: false },
              },
              {
                id: 'long',
                label: t('Long paths (300+ km)'),
                active: params.longPathsOnly,
                params: { longPathsOnly: true },
              },
            ]
          : HF_BANDS.map((band) => ({
              id: band.id,
              label: `${band.id} · ${freshRows().filter((row) => row.band === band.id).length}`,
              active: params[`band${band.id}`],
              color: band.color,
              params: { [`band${band.id}`]: !params[`band${band.id}`] },
            })),
        legend: vhf
          ? [
              { label: `<${formatNumber(300)} ${t('km')}`, color: '#55e2be' },
              {
                label: `${formatNumber(300)}–${formatNumber(800)} ${t('km')}`,
                color: '#ffb454',
              },
              { label: `${formatNumber(800)}+ ${t('km')}`, color: '#ff7eaa' },
            ]
          : HF_BANDS.map((band) => ({ label: band.id, color: band.color })),
        info: `${status} · ${t('Observed reception paths · last 30 minutes')} · ${t(vhf ? VHF_NOTICE : HF_NOTICE)}`,
        infoTitle: t(vhf ? VHF_NOTICE : HF_NOTICE),
      };
    },
    getStats() {
      const visible = visibleRows();
      return {
        count: visible.length,
        totalCount: freshRows().length,
        lastUpdate,
        error,
        stale: Boolean(error && freshRows().length),
        degraded: snapshot?.degraded === true,
        loading: vhf && snapshot?.waiting === true && !visible.length,
        sampled: true,
        connected: snapshot?.connected === true,
      };
    },
  };
  return layer;
}
