import * as Cesium from 'cesium';
import { t } from '../../i18n/index.js';
import { createViewArea } from '../../data/viewArea.js';
import { isEmergency } from '../../data/aircraftEmergency.js';
import {
  normalizeFlightFilters,
  flightMatchesFilters,
  flightIdentityHash,
  selectFlightDisplay,
} from '../../data/flightDisplayFilters.js';

/** One layer's display preferences and list. No scene listener or poller. */
export function createAircraftDisplayFilters({
  flightState,
  services,
  parts,
  layer,
}) {
  let filters = normalizeFlightFilters();
  let allowed = null;
  let listener = null;
  let openPanel = null;
  let lastSolveAt = -Infinity;
  let lastScale = '';
  const view = createViewArea();
  const motion = new Map();
  const candidates = [];
  const get = () => normalizeFlightFilters({}, filters);
  const protectedId = (id, info) =>
    id === flightState._trackedIcao ||
    id === flightState._cockpitSubjectId ||
    isEmergency(info?.emergency);
  function prepare(renderTime) {
    const viewer = flightState._viewer;
    if (!viewer) {
      allowed = null;
      return;
    }
    const camera = viewer.camera;
    const height = camera.positionCartographic?.height ?? 0;
    const pixels = viewer.scene.canvas?.clientHeight || 900;
    const fovy = camera.frustum?.fovy || Math.PI / 3;
    const metresPerPixel =
      (2 * Math.max(0, height) * Math.tan(fovy / 2)) / pixels;
    const thin = filters.declutterEnabled && height >= 100000;
    const scale = `${thin}:${Math.round(Math.log2(Math.max(1, metresPerPixel)))}`;
    const now = services.focus?.focusNowMs?.(Date.now()) ?? Date.now();
    // Membership needs no 60fps work. Motion keeps its original fleet cadence;
    // the quarter-screen warm margin covers the bounded 250ms membership gap.
    const solve =
      thin &&
      (!allowed ||
        now < lastSolveAt ||
        now - lastSolveAt >= 250 ||
        scale !== lastScale);
    if (solve) {
      view.update(camera);
      candidates.length = 0;
    }
    if (!thin) allowed = null;
    for (const [id, bb] of flightState._billboards) {
      const info = flightState.records.data.get(id) || {};
      let frame = motion.get(id);
      if (!frame) {
        frame = {
          position: new Cesium.Cartesian3(),
          candidate: { id, hash: flightIdentityHash(id) },
        };
        motion.set(id, frame);
      }
      const sample =
        id === flightState._trackedIcao
          ? bb.position
          : parts.motion?._deadReckon(id, frame.position, renderTime);
      frame.hasMotion = Boolean(sample);
      const current = sample || bb.position;
      if (current && current !== frame.position)
        Cesium.Cartesian3.clone(current, frame.position);
      frame.course = flightState._drCourseDeg;
      frame.speed = flightState._drSpeedMps;
      frame.hold = flightState._drCourseHold;
      frame.extrapolating = flightState._drExtrapolating;
      if (!solve) continue;
      const protectedContact = protectedId(id, info);
      if (!protectedContact && !view.contains(frame.position)) continue;
      frame.candidate.info = info;
      frame.candidate.position = frame.position;
      frame.candidate.protected = protectedContact;
      candidates.push(frame.candidate);
    }
    // Retention follows the actual record set, never an ever-growing ID cache.
    if (motion.size > flightState._billboards.size)
      for (const id of motion.keys())
        if (!flightState._billboards.has(id)) motion.delete(id);
    if (solve) {
      allowed = selectFlightDisplay(candidates, {
        filters,
        altitudeM: height,
        metresPerPixel,
      });
      lastSolveAt = now;
      lastScale = scale;
    }
  }
  function allows(id) {
    const info = flightState.records.data.get(id);
    return (
      protectedId(id, info) ||
      (flightMatchesFilters(info, filters) && (!allowed || allowed.has(id)))
    );
  }
  function set(input) {
    filters = normalizeFlightFilters(input, filters);
    allowed = null;
    flightState._lastFleetTickMs = 0;
    parts.rendering?._fleetTick();
    services.render?.governorRequestRender?.('flight-display-filters');
    listener?.();
  }
  const toggle = (key) => ({ displayFilters: { [key]: !filters[key] } });
  function getFlightList({ search = '', page = 0, pageSize = 50 } = {}) {
    const needle = String(search).trim().toLowerCase();
    const rows = [];
    let total = 0;
    for (const [id, info] of flightState.records.data) {
      total++;
      if (!flightMatchesFilters(info, filters) && !protectedId(id, info))
        continue;
      if (
        needle &&
        ![
          id,
          info.callsign,
          info.registration,
          info.typeCode,
          info.typeName,
          info.airline,
          info.originCountry,
        ].some((value) =>
          String(value || '')
            .toLowerCase()
            .includes(needle),
        )
      )
        continue;
      const bb = flightState._billboards.get(id);
      rows.push({
        id,
        label:
          String(info.callsign || '').trim() ||
          String(info.registration || '').trim() ||
          id,
        registration: String(info.registration || '').trim(),
        klass: info.klass || 'unknown',
        typeCode: info.typeCode || '',
        altitudeFt: Number.isFinite(info.altitude)
          ? Math.round(info.altitude / 0.3048)
          : null,
        onGround: info.onGround === true,
        selected: id === flightState._trackedIcao,
        visible:
          bb?.show === true || flightState._models.get(id)?.show === true,
      });
    }
    rows.sort(
      (a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id),
    );
    pageSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 50));
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    page = Math.max(0, Math.min(pages - 1, Math.floor(page) || 0));
    return {
      total,
      matching: rows.length,
      page,
      pages,
      rows: rows.slice(page * pageSize, (page + 1) * pageSize),
    };
  }
  return {
    prepare,
    allows,
    get,
    set,
    resetVisuals() {
      allowed = null;
      motion.clear();
      candidates.length = 0;
      lastSolveAt = -Infinity;
      lastScale = '';
    },
    positionFor(id) {
      const frame = motion.get(id);
      if (!frame || !frame.hasMotion) return null;
      flightState._drCourseDeg = frame.course;
      flightState._drSpeedMps = frame.speed;
      flightState._drCourseHold = frame.hold;
      flightState._drExtrapolating = frame.extrapolating;
      return frame.position;
    },
    methods: {
      getFlightList,
      attachFlightPanel(handler) {
        openPanel = typeof handler === 'function' ? handler : null;
      },
      setRowControlsListener(handler) {
        listener = handler;
      },
      getRowControls() {
        return {
          chips: [
            {
              id: 'flight-declutter',
              label: t('Declutter'),
              active: filters.declutterEnabled,
              params: toggle('declutterEnabled'),
            },
            {
              id: 'flight-airborne',
              label: t('Airborne only'),
              active: filters.airborneOnly,
              params: toggle('airborneOnly'),
            },
            {
              id: 'flight-types',
              label: t('Aircraft types'),
              active: filters.typeFilterEnabled,
              params: toggle('typeFilterEnabled'),
            },
            {
              id: 'flight-altitude',
              label: t('Altitude range'),
              active: filters.altitudeFilterEnabled,
              params: toggle('altitudeFilterEnabled'),
            },
            {
              id: 'flight-list',
              label: t('List & filters'),
              active: false,
              onClick: () => openPanel?.(layer.id),
            },
          ],
        };
      },
    },
  };
}
