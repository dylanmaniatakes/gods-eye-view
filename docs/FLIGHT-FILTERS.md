# Flight list and display filters

The **Flights** panel on the right rail contains the loaded flight list and
display filters. Choose **Live Flights** or **Military Flights**; each feed keeps
its own settings. The corresponding Data Layers row exposes four independent
toggles and a **List & filters** shortcut:

- **Declutter** reduces overlapping aircraft icons in views at 100 km altitude
  and above. Balanced and Sparse control the spacing. Close views reveal every
  matching aircraft. Turning it off shows every matching in-view contact.
- **Airborne only** hides contacts explicitly reported as on the ground.
- **Aircraft types** enables the type checklist configured in the Flights panel.
  Initially it selects airliners, widebodies and four-engine jets. Turning the
  filter off preserves the checklist for later use.
- **Altitude range** uses reported aviation altitude in feet. The panel accepts
  minimum and maximum values; unknown altitude does not match an enabled range.

The Flights panel and its right-rail button are hidden while both flight layers
are off. Enabling either Live Flights or Military Flights makes them available
again. Hiding the panel also stops its roster refresh timer.

Selected and emergency aircraft bypass the display filters. The full source
records, history, search and analyst queries remain intact. Automatic
decluttering chooses stable, identity-hashed winners in Earth-fixed cells;
panning at the same zoom does not reshuffle a screen-anchored grid. Membership
refreshes at most every 250 ms with a warm margin beyond the view; explicit
filter changes and zoom-scale transitions refresh immediately. The existing
fleet render cadence and tracked-aircraft path remain in place. Hidden motion is
still estimated so moving contacts can enter the view without a new source poll.

The panel lists every loaded aircraft matching the manual filters, including
those hidden by decluttering. It shows 50 rows per page and searches callsign,
registration, ICAO identity, aircraft type, airline and country. Click a row to
select that aircraft using the same selection/focus preference as the map.
The total is the loaded feed, not a claim of worldwide coverage.

Display preferences are saved locally under `gev:flight-display-filters:v1`,
separately for each feed. They are not provider data or share-link settings.
Search text and the current list page are transient. The roster refreshes at
most once a second while its panel is open and the document is visible; it
does not create another flight-feed poller or render-loop hold.

Verification:

```sh
node --import=./build/registerVue.js --test \
  src/data/flightDisplayFilters.test.mjs \
  src/layers/aircraft/displayFilters.test.mjs \
  src/ui/flightPanel.test.mjs src/ui/flightPanelView.test.mjs
node scripts/qa-flight-filters.mjs
```

The browser check uses 400 synthetic contacts through the real rendering and UI
paths, verifies each quick toggle and combined filters, then selects a flight
hidden by decluttering from the full searchable roster.
