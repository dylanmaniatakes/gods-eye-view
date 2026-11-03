# AGENTS.md — Project Context for God's Eye View

> **Purpose:** Working context for development in this fork. This file does not
> exist upstream — when branching for a PR, branch from `upstream/main` so this
> file never appears in a PR diff.

## What this project is

God's Eye View (`gods-eye-view`, v0.3.0, MIT license, maintained by Bilawal
Sidhu and Sameh Khamis at Halfpixel) is a real-time intelligence console for
planet Earth: a photorealistic CesiumJS 3D globe running entirely in the
browser, layering live aircraft, ships, satellites, earthquakes, traffic,
public CCTV, weather, and more — with hands-free voice control via a realtime
AI agent. All data sources are public; scraping against terms of service or
paywalled data is against project ground rules.

## Fork state snapshot (2026-11-02)

- Upstream: `https://github.com/bilawalsidhu/gods-eye-view.git` (as `upstream`)
- Fork: `git@github.com:YOUR_USER/gods-eye-view.git` (as `origin`) — **set this after forking on GitHub**
- Baseline commit: `0e27d69f` (upstream main at setup time)
- Working tree was clean; `node_modules` installed; `.env` present with keys for
  OpenAI, Mapillary, TomTom, AISStream, FIRMS, Cesium ion, Gemini.
- System git identity: Dylan Maniatakes `<dylanzmaniatakes@gmail.com>`
- `gh` CLI not installed — forking happens on github.com, or `brew install gh`.
- Unit-test baseline at `0e27d69f` on Node 24.10.0: **9827 tests, 9821 pass, 5 fail**,
  and the 5 are environment/load artifacts, not code breakage:
  two timing/process-spawn timeouts (`analystEngine` perf budget, `geoFileImport`
  spawnSync) that pass when run in isolation; a `radioPanel` render test that
  passes in isolation; a WSDOT camera-name encoding diff (`\x96` vs `–`);
  and a FIRMS proxy test expecting `ECONNREFUSED` where this Mac's network
  stack reports `ETIMEDOUT` (stealth firewall drop vs RST). No upstream fix
  needed before starting work; rerun a failing test solo before believing it.

### Known environment gap

- **Node 24.10.0 is below the required floor.** `package.json` engines want
  `>=24.14.0 <25 || >=26 <27`, and CONTRIBUTING recommends 24.22.2+ for
  security fixes. `npm run doctor` reports the app will not start until this
  is fixed. Node is currently Homebrew-managed; either `brew upgrade node`
  (global, affects all projects) or install a version manager (`nvm`/`fnm`)
  and pin ~24.22.x for this repo. Doctor output otherwise shows all bundled
  providers OK; Google Maps and OpenSky keys are optional/absent (keyless
  fallbacks cover both).

## Repo map

| Path | What lives there |
|---|---|
| `src/app/` | Application assembly: construct components, share scene/request services, startup/dispose |
| `src/standalone/` | Default catalog, local sources, setup controls for the standalone app |
| `src/layers/<family>/` | One folder per globe layer family (30 families: aircraft, vessels, satellites, earthquakes, cctv, weather, wind, firms, traffic, transit, radio, launches, military, etc.). Each layer implements `init/enable/disable/update/destroy/getStats` (+ optional `getDetectableObjects`) |
| `src/ui/` | Vue 3 components. Views in `src/ui/views/` (+ `views/panels/`), feature components beside their owner (`src/ui/rail/`, `src/ui/weather/`). Reusable controls in `src/ui/kit/` (UiButton, UiSelect, UiSlider, UiSegmented, UiChip, UiBadge, UiEmpty, UiIcon, UiTooltip, UiPanel, UiRail) — reuse the kit before writing controls |
| `src/ui/stores/` | Pinia stores; state lives here, views just render and forward events |
| `src/sources/` | Portable data-source factories |
| `src/services/` | Application operations |
| `src/voice/` | Voice control: `actionSchemas.js` (argument definitions), `gevActions.js` (client-side execution). Server tool descriptions in `server/providers/openai/tools.js` |
| `src/styles/` | GLSL post-process sensor looks (CRT, NVG, FLIR/thermal, Noir) |
| `server/providers/` | Local proxies for anything needing a private key — **secrets stay server-side**; the browser only ever sees a restricted Google Maps key and ephemeral tokens |
| `scripts/` | 150+ tooling scripts, including the `qa-*.mjs` headless feature gates |
| `docs/` | Project docs. `CURRENT-STATE.md` is the authoritative runtime reference — read it first |
| `changelog.d/<pr#>-<slug>.md` | Changelog fragments (one per PR; never edit `CHANGELOG.md` directly) |
| `public/`, `config/`, `build/`, `tools/`, `pinokio/` | Assets, configs, build glue, install packaging |

Entry point: `vite.config.js` → `server/standalone/vite.config.js`. Dev app at
`http://localhost:4173`. UI framework: Vue 3 + Pinia; globe: CesiumJS
(+vite-plugin-cesium); build: Vite 6. No TypeScript — plain ESM JavaScript.

## Commands

| Task | Command |
|---|---|
| Setup health check | `npm run doctor` |
| Dev server | `./scripts/dev-fresh.sh` (pulls macOS Keychain keys) or `npm run dev` |
| Production build + local check | `npm run build && npm run preview` |
| Unit tests (standalone, no server needed) | `npm test` |
| 3D flight-tracking regression (needs dev server at :4173) | `npm run test:track` |
| Feature gates (pick the one for the area you touched) | `node scripts/qa-*.mjs` (npm aliases: `qa:map-source-tray`, `qa:street-level`, `qa:street-level:fixtures`, `qa:transit`) |
| Format | `npm run format` then `npm run format:check` |
| Boundary checks | `npm run check:boundaries` |
| i18n check | `npm run i18n` |
| Add / verify a share-link layer token | `npm run layer-token:next -- <layer-id>`, then `npm run layer-token:check -- --base-ref upstream/main` |
| Run one Vue/DOM test file | `node --import=./build/registerVue.js --test <file>` |

**Pre-PR gate (all three must stay green, plus your feature gate):**
`npm run build`, `npm test`, `npm run test:track`.
CI does **not** run `test:track` or most `qa-*.mjs` gates for you — that
evidence must come from local runs in the PR description.

## Coding conventions (upstream rules — must follow for mergeable PRs)

- ESM JavaScript, **2-space indent, single quotes, semicolons**, LF endings.
- JSDoc on exported/public functions. Match surrounding comment density and idiom.
- Conventional-commit prefixes (`feat:`, `fix:`, `perf:`, `docs:`) appreciated, small reviewable commits.
- All user-visible text goes through `t()`/`tn()`; English held in
  constants/stores is marked with `msg()` and translated at render.
  `data-i18n*` attributes only in static page markup. `npm run i18n` must pass.
- State in Pinia stores; views hold no application logic. Owner → store →
  view flow; multiple owners on one store coordinate via `createOwners()` /
  `act()` / `detach(token)` from `src/ui/stores/owners.js`.
- **No hand-written DOM binding** — render from the store; use `<Teleport>`
  to render outside a view's host. Exceptions (body/head classes, focus moves,
  same-task measured layout, Cesium/overlay canvases, live video) are recorded
  in `docs/VUE-MIGRATION.md`.
- Portable owners must not import Vue/Pinia (enforced by `npm run check:boundaries`).
- New world text labels go through the world-overlay host; Cesium text labels are forbidden.
- Test Vue components by mounting over happy-dom, not by asserting markup
  strings; compare nodes with `assertSameNode()` from `src/testSupport/domAssert.mjs`.
- Keep mechanical formatting in its own commit, separate from behavior changes.
- Never add data you don't have the right to redistribute — fetch at runtime.
  Don't present public-data inference as authoritative intelligence.

## How to change things the upstream way

1. **Branch from `upstream/main`** (never from this file's branch).
2. Make the change green: build / test / test:track + the `qa-*.mjs` gate for
   the touched area (find it via `docs/CURRENT-STATE.md` or the gate header).
3. Runtime behavior changes: update `docs/CURRENT-STATE.md` in the same PR.
4. Changelog: add `changelog.d/<pr-number>-<slug>.md` (write it exactly as it
   should read in CHANGELOG.md, `-` bullet, credit yourself). Don't edit
   `CHANGELOG.md`.
5. New/changed data source: add licence+attribution to `DATA_SOURCES.md` and
   register the credit in `src/data/dataCredits.js`.
6. New shareable layer: assign a token with `npm run layer-token:next` (0–9
   then two-char base-36; `0`–`3` are taken), record it in both
   `LAYER_STATE_REGISTRY` and `src/data/layerStateTokenReservations.json`,
   update the registered-count assertion, then run `layer-token:check`.
   Tokens are immutable — never reassign or repurpose one.
7. PR description must follow `.github/pull_request_template.md`. **New layers
   additionally need all four:** screenshot(s) on the globe + info card, a
   15–30 s screen recording, the proposed layer-panel group (see `PANEL_GROUPS`
   in `src/ui/layerPanel.js`), and full data source/licence details.
   Maintainers may hold the PR until all four are present.
8. Good first lanes (per CONTRIBUTING): new CCTV city source pack, new/improved
   data layer, voice-control extensions, GLSL visual styles, first-run bug
   fixes (see `docs/KNOWN-ISSUES.md`).

## Fork maintenance workflow

```bash
# Sync with upstream
git fetch upstream
git checkout main && git merge --ff-only upstream/main

# Start work for an eventual PR
git checkout -b feat/<slug> upstream/main

# Personal / experimental work (not for upstream)
git checkout -b tinkering/<slug> main
```

- Keep `main` = upstream + only fork-local files (like this one) so
  `--ff-only` syncs keep working; do real work on branches.
- Upstream also ships `.agents/skills/community-pr` with the maintainer PR
  review workflow, and `docs/MAINTAINER_WORKFLOW.md` describes how maintainers
  review and merge — useful reading before submitting.

## Ideas backlog

<!-- Dylan: add ideas here. Format suggestion:

### <idea name>
- **What:** one-paragraph description
- **Where it plugs in:** layer / voice / style / UI / provider
- **Upstream potential:** high / medium / personal-only (and why)
- **Notes:** data source + licence questions, rough approach
-->

_(empty — ideas go here)_

## Open questions / follow-ups

- [ ] Fork the repo on GitHub, then: `git remote add origin git@github.com:YOUR_USER/gods-eye-view.git && git push -u origin main`
- [ ] Fix Node: upgrade to ≥24.14 (`brew upgrade node`, or install nvm/fnm and pin 24.22.x), then rerun `npm run doctor`
- [ ] Optional keys not configured: Google Maps/Places, OpenSky — fine without (keyless fallbacks), revisit if a feature needs them
