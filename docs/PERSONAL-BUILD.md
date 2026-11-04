# Personal build — November 3, 2026

This build combines the newer upstream fixes with the local features completed
today. The changes below remain part of this fork even where the upstream PRs
are still open.

The integration baseline is fork `main` at `b72159ef`. For this publication,
the later upstream typed-chat, FAA-airspace and Houston-camera batch is deferred.
Existing fork share-link tokens are retained.

- Hide ambient camera names at 30 km viewer altitude and above. Below that,
  progressively cap names at 12, 15 or 17 with extra spacing in dense areas.
  Camera markers and brackets remain available; names return on zoom in.

- Reduce camera marker density automatically as the map zooms out, with
  progressively wider spacing and bounded overview counts. Ambient thumbnails
  reduce at wide metro views and hide at regional views; zooming back in restores
  camera detail. The selected camera stays available throughout.

- Add independent decluttering, airborne-only, aircraft-type and altitude-range
  toggles beneath both flight layers. A Flights panel on the right rail provides
  detailed controls and a paged, searchable list of the complete loaded feed,
  including aircraft hidden by decluttering. Selected/emergency contacts remain
  available; feed records and search are preserved, and each feed's display
  preferences are saved locally.
- Hide the Flights panel and its side-menu button when both flight layers are
  off; enabling either feed restores access without losing filter preferences.

- Reduce idle frontend work without lowering the 60 FPS interaction target.
  Cyber's voice scanner runs only while voice is active and moves with a
  transform instead of forcing layout. Its sonar sweep rotates a smaller
  surface while preserving its timing and appearance. Civil and military
  aircraft outside the view plus a quarter-viewport margin skip visual updates
  and new model loads; current motion estimates and tracked rendering continue,
  and cached models remain eligible for reuse during return pans.

- Fix civilian ship names leaking through the detection overlay after ambient
  vessel cards were disabled. Civilian and unknown vessels show names only in
  their selected detail card; explicitly military vessels (including AIS type 35) retain ambient detection labels. Map markers and brackets remain visible.

- Add independent decluttering, underway-only, vessel-type and speed-range
  toggles under Live Vessels. The Vessels app on the right rail provides detailed
  controls and a searchable, paged list including vessels hidden by decluttering.
  Selected vessels stay visible, source records remain intact, and preferences
  are saved locally. The app and its menu button hide when Live Vessels is off.

The merge also brings in upstream's bounded zoom-out navigation, reusable area
and OpenStreetMap voice actions, radio priority-country improvements, and safer
handling of military reports without position fixes.

PennDOT Traffic Cams now has an independent Data Layers toggle beside Cameras.
Both categories share one viewer and playback owner; manually found local
webcams stay in Cameras. Inspection also works when only PennDOT is enabled.

Other local additions retained in this build include Chester County incident
controls, Pennsylvania camera feeds, saved views and display preferences, per-HUD
accent colors, selected-object inspection and camera return, popup visibility
preferences, and S2 GhostMaps age filtering.

Integration fixes keep Esri Hybrid reachable through voice and classify submarine
cables against its terrain surface. County-panel bindings tolerate catalogs that
omit that optional layer. Mission-roster tests cover both inspection and automatic
camera-focus preferences.

The voice tool schema uses a portable area-identifier pattern accepted by the
Realtime API, while execution retains strict Unicode identifier validation.

Details: [Flight filters](FLIGHT-FILTERS.md), [Vessel filters](VESSEL-FILTERS.md),
[Selected-object controls](OBJECT-INSPECTION.md), [Saved views](SAVED-VIEWS.md),
and [Chester County incidents](CHESTER-COUNTY-EMS.md).
