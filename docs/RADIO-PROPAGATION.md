# Observed HF and VHF propagation

In **Data Layers → Audio**, enable **HF Propagation** or **VHF Propagation (2 m)**.
Both start off. No radio hardware, callsign registration or API key is needed.

HF draws a different colour for each of 10, 20, 40, 80 and 160 m. The five chips
independently show or hide those bands. VHF shows 144–148 MHz reports, with green
paths below 300 km, amber at 300–800 km, and pink at 800 km and above. Its
**Long paths (300+ km)** chip hides shorter reports. These distance bins are
visual aids, not classifications of normal propagation or ducting.

Paths fade with report age and expire after 30 minutes. Click a path to inspect
its transmitter, receiver, Maidenhead locators, frequency, SNR, mode and UTC time
in OBJECT DETAILS. Connections follow illustrative short great-circle arcs;
their heights do not describe actual ionospheric hops or atmospheric ducts.
Positions are locator centres, so reported distances are approximate, especially
for four-character locators. No callsign address lookup is performed.

## What the display can tell you

The display shows where reporting stations have actually heard one another.
It helps reveal active directions and observed reach. Counts depend on station
activity, receiving coverage and the sampled data, as well as propagation.
No reports does not mean a band is closed. An HF digital-mode reception does
not guarantee a usable SSB or CW contact with your antenna and power.

Long 2 m paths can reveal an opening. They do not establish its cause: terrain,
antenna height, troposcatter, sporadic E, meteor or aircraft scatter, EME, and
bad reports can also affect the picture. The layer does not estimate a reliable
service radius for your station and does not provide a meteorological ducting
forecast. VHF's summary is the longest path in the displayed sample, not a
guaranteed achievable range.

For an independent weather-based comparison, open
[Hepburn's tropospheric ducting forecast](https://www.dxinfocentre.com/tropo.html).
Its [usage restrictions](https://www.dxinfocentre.com/licence.htm) prohibit
reposting current and forecast maps in apps. This implementation links to that
service here without copying or georeferencing its images.

## Sources and acquisition

- **HF:** [WSPR Live](https://wspr.live/), sourced from WSPRnet. The public,
  read-only HTTPS API supplies snapshots cached for two minutes per source
  instance; failed requests can retry on the next one-minute layer tick.
  Fixed SQL filters the last 30 minutes and only the selected band
  family. Repeated directional station-pair/locator reports are grouped, and
  a stable geographic hash orders a sample capped at 300 paths per band and
  1,500 total. The band chips filter that cached sample without new requests.
  The globe refreshes each minute to fade and expire paths.
- **VHF:** [PSK Reporter's public MQTT distribution](https://www.mqtt.pskreporter.info/)
  operated by Tom M0LTE, with reception reports originating from Philip
  Gladstone's PSK Reporter. A lazy-loaded MQTT.js client subscribes only to
  `pskr/filter/v2/2m/#` over secure WebSockets. A WSPR 2 m snapshot seeds the
  initial picture; live MQTT then accumulates reports while enabled. Data
  received before that subscription, other than the WSPR sample, is unavailable.
  The display updates every ten seconds. Disable/destroy aborts the seed fetch,
  closes MQTT immediately and removes displayed paths. There is no server-side
  collector or disk archive.

Malformed, unlocated, future-dated, expired and out-of-band reports are rejected.
Each source/layer retains at most 1,500 paths; VHF drops older entries first.
HTTP responses have a 20-second deadline and a 2 MiB cap. MQTT messages above
8 KiB are ignored. A failed HF refresh retains only unexpired evidence and
marks it stale; a successful empty feed clears it. A VHF disconnection is
labelled even while the WSPR seed or recent reports remain visible.

WSPR Live explicitly permits projects whose results are freely accessible and
prohibits commercial or profit-oriented use. Its raw reports may contain errors
and its volunteer service has no availability guarantee. This data is not
covered by the application's MIT code licence. The MQTT service explicitly
invites clients/scripts/apps to use its public feed; this is service access,
not a claim that the underlying reports have an unrestricted open-data licence.
Both providers are credited in Data attribution and DATA_SOURCES.md. No report
dataset is bundled in the repository.

## Persistence and validation

Fork share tokens are `01` for HF and `02` for VHF, allocated after the
published fork ledger. HF's five band switches and VHF's long-path filter survive
share restoration and browser persistence. Existing tokens keep their meaning.
These fork allocations must be reconciled with the then-current upstream ledger
before an upstream PR. Voice toggling/querying is deferred because the existing
Realtime prompt is at its documented budget; use the Data Layers controls.

Tests: `node --test src/layers/propagation/*.test.mjs`.
Browser gate: `QA_BASE_URL=http://localhost:4173 node scripts/qa-propagation.mjs`.
The browser gate uses synthetic reports, and its screenshot is labelled synthetic
in the filename. Live service checks are separate from those fixture results.

### November 4, 2026 validation

- Production build, source/package boundaries, locale catalogs and the fork
  token ledger passed. Propagation files pass formatting and whitespace checks.
- The full unit plan passed with four workers: 10,639 passed and one skipped.
  The two Node-24-calibrated allocation probes were excluded on Node 26.13.0,
  matching the standard runner. Higher concurrency caused load-related timing
  failures; their isolated reruns passed.
- The propagation browser gate passed filters, real globe picks/inspection,
  stale/empty responses, share restoration and a narrow German layout.
- A separate live browser loaded and rendered 1,493 WSPR paths across all five
  HF bands, with no page errors. Live VHF loaded 32 paths, connected to the
  MQTT service, and its WebSocket closed immediately on disable.
- Tracking passed 107 of 109 assertions. Two flight arrival-orientation checks
  reached the correct orientation but exceeded their 500 ms observation deadline
  (575/585 ms) during concurrent verification. Tracking remains an outstanding
  pre-PR gate; this change has not been published as a PR.

[Live HF snapshot](media/radio-propagation-live.png) ·
[Synthetic filter and inspection example](media/radio-propagation-synthetic.png).
