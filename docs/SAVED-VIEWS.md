# Selection and saved views

Ordinary map clicks preserve the overview by default. Aircraft and satellites
keep their selected appearance and detail context without taking the follow
camera. Fire and vessel selection keeps its existing marker/card emphasis.
Selecting CCTV activates its feed/projection and camera panel without flying
the globe to it. Launch marker selection stays in place too. Use the existing
explicit **FOCUS**, **Follow**, or camera focus actions to navigate deliberately.

The bookmark button in the top globe action bar opens **Saved views**. The
**Focus map on selection** checkbox restores the previous click-to-focus
behavior. This preference persists in the browser.

Enter a name and click **Save view**. Click a saved name to restore it, **Update**
to replace its camera snapshot, or **Delete** to remove it. **Return to previous
view** returns to the camera position before the last restore; repeated presses
swap the two views. A restore releases cockpit, orbit and follow ownership so
those modes cannot pull the camera away from the bookmark.

Bookmarks capture camera latitude, longitude, altitude, heading, pitch and roll.
Layers and visual styling remain as currently configured. Up to 50 views are
stored in this browser's local storage for this app origin. Other devices and
origins have separate libraries. Clearing browser storage removes the library.
Duplicate names require explicit Update; storage errors are shown without
reporting a successful save. Tabs on the same origin read the shared library.

For single-click live object details, double-click focus and the separate
**Restore last view** button, see [Object inspection](OBJECT-INSPECTION.md).

## Local MCP

Both the built-in HTTP `/mcp` server and `npm run mcp` expose:

- `list_view_sessions`: connected local browser tabs and their session IDs.
- `list_saved_views`: bookmarks in a tab's browser library.
- `save_view`: save the current camera with `name`; use `overwrite: true` only
  when deliberately replacing an existing bookmark.
- `restore_view`: restore a bookmark by `name`.
- `delete_saved_view`: delete a bookmark by `name`.
- `restore_previous_view`: return to the view before the last bookmark restore.
- `set_selection_camera`: `focus: false` selects in place; `true` enables focus
  on ordinary selection.

All tools except `list_view_sessions` accept an optional `session`. Exactly one
connected tab is selected automatically; multiple tabs require an explicit ID.
The globe must be open on the same local app server. The browser executes the
same actions as the buttons; MCP waits for its reply, reports storage/action
errors, and expires queued requests after eight seconds. A timeout is not proof
that a delivered action did not execute: inspect the current state before
retrying. A closed or suspended tab cannot be controlled reliably.

The relay (`/api/view-session` and `/api/view-control`) uses the same loopback,
Host, Origin and proxy-header checks as `/mcp`. This preserves the existing
local MCP boundary: reverse-proxied/remote browser sessions are not attached.
The UI and browser-local bookmarks still work when served remotely. The stdio
server reaches the relay through its configured local API base URL.

## Verification

```sh
node --import=./build/registerVue.js --test src/ui/savedViews.test.mjs server/mcp/viewSessions.test.mjs
QA_BASE_URL=http://localhost:4173 node scripts/qa-saved-views.mjs
```

The browser gate verifies UI saving, persistence after reload, MCP restoration,
previous-view restoration, and world selection without camera movement.

### Validation on 2026-11-03

The feature browser gate passed UI save, persistence, HTTP MCP restore/undo,
stdio relay requests, a real aircraft click with no camera movement, and explicit
Focus after in-place selection. The 110-test focused run passed, including the
bookmark UI, storage, HTTP relay guards, existing flight/military behavior, MCP
inventory, provider composition and icon subset checks. Production builds,
translation checks and architecture checks passed during development.

The broad suite initially reported 10 failures among 10,030 tests. Three were
new inventory/icon expectations and were fixed; six timing/launcher failures
passed targeted reruns. The existing KML child-process deadline remains
uncertified. The tracking harness passed clean startup and synthetic ingestion,
but failed its share-link aircraft restoration wait after reload; the full
tracking gate is not certified green. No upstream PR has been opened.
