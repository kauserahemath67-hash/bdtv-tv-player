# BDTv Live TV Application Audit

Audit scope: the checked-out `main` tree and the APK bundled in the repository. No production endpoints or third-party streams were contacted. The GitHub `data-storage` branch, live Vercel routing, stream uptime/CORS, and Android runtime behavior therefore remain unverified where noted.

## 1. Project map

### Files and jobs

| File | Job |
|---|---|
| `package.json` | Project metadata and `node server.js` start script; no declared dependencies or test/build scripts. |
| `server.js` | Local Node HTTP server, local API route table, JSON body parsing, and static serving from `public/`. |
| `vercel.json` | Vercel URL rewrites and security/CORS/cache headers. |
| `index.html` | Public player markup; references player CSS, HLS.js CDN, and player JS. |
| `admin.html` | Admin login, dashboard tabs, forms, tables, and preview player markup. |
| `README.md` | Bengali deployment, feature, and credential documentation. |
| `supabase-schema.sql` | Proposed PostgreSQL tables for channels, customers, devices, reports, and settings; no application code executes Supabase queries. |
| `.gitignore` | Ignores `node_modules`, `.vercel`, `.env`, and `.DS_Store`. |
| `.DS_Store` | macOS Finder metadata; not application logic. |
| `BDTv.apk` | Android APK artifact; byte-identical to `public/BDTv.apk`. |
| `api/_db.js` | GitHub Contents API JSON persistence, 20-second in-process caches, fallbacks, and in-memory activity/report state. |
| `api/activity.js` | Accepts player heartbeat posts and exposes active connections to admins. |
| `api/auth.js` | Admin password login, bearer-token issuance/verification, and in-memory login throttling. |
| `api/channels.js` | Public channel listing/filtering and admin channel CRUD, status updates, and ordering. |
| `api/customers.js` | Customer PIN lookup and admin customer listing/create/delete. |
| `api/devices.js` | Customer-device registration/validation and admin device listing/block/unblock/delete. |
| `api/download.js` | Reads and streams the APK from one of several local paths. |
| `api/health.js` | Admin-only single-channel and batch HEAD probes plus manual status overrides. |
| `api/playlist.js` | Dynamic M3U export and admin playlist URL/raw-text diagnose, import, refresh, and parse. |
| `api/playlists.js` | Admin saved-playlist listing, save, and delete. |
| `api/report.js` | Public playback-report submission and admin report list/resolve operations. |
| `api/settings.js` | Public settings read with admin credentials removed; admin settings write. |
| `api/subscriptions.js` | Admin subscription listing and renewal/extension. |
| `api/version.js` | Public version read and admin version/update metadata write. |
| `js/player.js` | Public player lifecycle, HLS/native playback, errors, remote/touch input, VIP checks, and update flow. |
| `js/admin.js` | Admin authentication UI, API calls, channel/customer/device/playlist/settings/version management, and client health scanner. |
| `css/player.css` | Full-viewport player, drawer, cards, overlays, focus styling, and responsive breakpoints. |
| `css/admin.css` | Dashboard layout, tables/forms/modals, and admin responsive styling. |
| `data/channels.json` | Checked-in channel snapshot (82 entries); the player API does not directly read this working-tree file. |
| `data/initial-channels.json` | Seven-channel seed/example snapshot; no runtime reference found. |
| `data/customers.json` | Checked-in customer record including a plaintext PIN; runtime code reads the GitHub data branch instead. |
| `data/settings.json` | Checked-in settings including plaintext admin credentials; runtime code reads the GitHub data branch instead. |
| `data/store.json` | Small status/update marker; no runtime reference found. |
| `data/version.json` | Checked-in version/update snapshot; runtime version API reads the GitHub data branch instead. |
| `public/index.html` | Public-directory copy of the player page; SHA-256 matches root `index.html`. |
| `public/admin.html` | Public-directory copy of the admin page; SHA-256 matches root `admin.html`. |
| `public/js/player.js` | Public-directory copy of player JS; SHA-256 matches root `js/player.js`. |
| `public/js/admin.js` | Public-directory copy of admin JS; SHA-256 matches root `js/admin.js`. |
| `public/css/player.css` | Public-directory copy of player CSS; SHA-256 matches root `css/player.css`. |
| `public/css/admin.css` | Public-directory copy of admin CSS; SHA-256 matches root `css/admin.css`. |
| `public/data/version.json` | Public-directory version snapshot; SHA-256 matches `data/version.json`. |
| `public/BDTv.apk` | Public APK download artifact; SHA-256 matches root `BDTv.apk`. |
| `public/.DS_Store` | macOS Finder metadata; not application logic. |

### Channel source and playback flow

1. `index.html` loads `/css/player.css`, synchronous `https://cdn.jsdelivr.net/npm/hls.js@latest`, then `/js/player.js` (index.html:8-10, 170).
2. `IPTVPlayer.init()` awaits `/api/settings`, then awaits `loadChannels()`; it starts the update check after channel load (js/player.js:65-73, 83-90, 316-355). The channel request is `/api/channels?code=...&pin=...&device_id=...`.
3. `/api/channels` loads settings, optionally validates a customer and device, then calls `db.getChannels()` (api/channels.js:40-112). `_db.js` reads `data/channels.json` through the GitHub Contents API on the `data-storage` branch, using only a 20-second per-process cache; if the GitHub file is missing/empty it returns seven hardcoded defaults (api/_db.js:14-23, 68-110, 146-160). The local `data/channels.json` and `data/initial-channels.json` are not the runtime source. Live branch contents were not fetched and are **unverified**.
4. The API filters non-ONLINE channels for non-admin requests and sorts pinned channels first, then by order (api/channels.js:111-138). If the API errors or returns no channels, the public player falls back to three demo channels unless it believes VIP mode is enabled (js/player.js:336-355).
5. On load it automatically selects channel 0. `playChannel()` uses the supplied stream URL directly: HLS.js for supported `.m3u8`-like URLs, otherwise `video.src` (js/player.js:653-692). There is no BDTv streaming proxy. HLS.js requires the third-party stream host to permit browser CORS; native playback behavior is browser/WebView-specific.
6. Every channel selection uses the already-loaded in-memory channel list; it does not refetch the list on each click. New admin changes reach a viewer after a page reload/reinitialization; no channel-list polling/push updates the player’s cached list.

### Player library and admin channel changes

- The player is HLS.js, but its version is **not pinned**: both pages load `hls.js@latest`; `package.json` contains no HLS dependency/version (index.html:10; admin.html:8; package.json).
- Player configuration is in `IPTVPlayer.initHLS()` (js/player.js:441-463). Admin preview uses its own HLS setup (js/admin.js:389-439).
- Admin add/edit posts channel fields to `/api/channels`; delete uses `DELETE /api/channels?id=...`; status/order use `PUT` (js/admin.js:328-369, 440-480). The API calls `_db.js`, which writes JSON to the GitHub `data-storage` branch (api/channels.js:139-215; api/_db.js:121-138, 164-198). Write failures are not consistently surfaced; see issue M9.

### API/server route inventory

All API handlers set permissive `Access-Control-Allow-Origin: *` headers (with Vercel also applying wildcard CORS to `/api/*`). Most JSON handlers return JSON for their own handled errors; unknown local static routes return HTML, and the APK handler’s missing-file response is plain text. GitHub API calls in `_db.js` have no explicit timeout, so their endpoint latency/timeout behavior is platform-dependent.

| Endpoint | Purpose and inputs | Error/status behavior |
|---|---|---|
| `/api/auth` | `POST {email,password|pin}` login; `GET Authorization: Bearer ...` session check. | 200 success; 400 missing password; 401 bad credentials/session; 429 in-memory lockout; 405 other methods. Settings read occurs before method dispatch (api/auth.js:42-60, 62-131). |
| `/api/channels` | `GET` optional `category`, `search`, `code`, `pin`, `device_id`; `POST` channel fields; `PUT` `orderList`, status/id, or `batchUpdates`; `DELETE` id. | JSON 200, 400, 401, 403, 404, 405, 500 (api/channels.js:26-216). |
| `/api/playlist` and `/playlist.m3u` | `GET` M3U or admin playlist list; optional `format`, `action`, `all`, VIP code/PIN; `POST` URL/raw content, action, playlist name, replace flag. | JSON 200/400/401/403/405/500; M3U success is text. URL fetch has a 12-second request timeout but no URL allowlist, TLS verification, or response-size cap (api/playlist.js:25-56, 162-212, 219-388). |
| `/api/playlists` | Admin `GET`; `POST {name,url,format,channelCount,...}`; `DELETE id`. | JSON 200/400/401/404/405/500 (api/playlists.js:28-72). |
| `/api/settings` | `GET` public settings with admin password/PIN fields removed; admin `POST` arbitrary settings object. | JSON 200/401/405/500 (api/settings.js:8-44). |
| `/api/customers` | `GET code,pin` customer check; admin `GET` all, `POST` customer fields, `DELETE id`. | JSON 200/400/401/403/404/405/500 (api/customers.js:28-118). |
| `/api/devices` | `GET customer_id` or admin list; `POST` customer id/code and fingerprint/device metadata; admin `PUT` block/unblock and `DELETE` device. | JSON 200/400/401/403/404/405/500 (api/devices.js:27-114). `GET customer_id` skips the admin check. |
| `/api/health` | Admin `GET` `channel_id` or full scan/`auto_scan`; `POST {id,manual_override,status}`. | JSON 200/400/401/404/405/500; stream probe uses a 3-second HEAD timeout (api/health.js:38-68, 84-173). |
| `/api/activity` | Public `POST` heartbeat metadata; admin `GET` active connections. | JSON 200/401/405/500; connection state is process memory only (api/activity.js:24-66; api/_db.js:522-551). |
| `/api/report` | Public `POST` channel report; admin `GET` and `PUT {id}` resolve. | JSON 200/400/401/405/500; report state is process memory only (api/report.js:27-70; api/_db.js:686-700). |
| `/api/subscriptions` | Admin `GET`; `POST {customer_id,days_to_add,plan,payment_method,transaction_reference}` renews. | JSON 200/400/401/404/405/500 (api/subscriptions.js:27-101). |
| `/api/version` and `/version.json` | Public `GET`; admin `POST` version/APK/update fields. | JSON 200/401/405/500 (api/version.js:8-51; server.js:76-79). |
| `/api/download` | Serves APK from disk; no input. | OPTIONS returns 200; missing file returns plain-text 404; other methods are not rejected and no Range handling is implemented (api/download.js:6-41). This route is not in the local `server.js` route map (server.js:9-21), although Vercel’s generic API rewrite covers it. |

The local server silently converts malformed JSON request bodies to `{}` and imposes no body-size limit (server.js:49-67). Its static 404 is HTML (server.js:90-97). `vercel.json` has no explicit API cache, stale-while-revalidate, or compression configuration; it sets no-store on HTML/JS/CSS and security/CORS headers on API routes (vercel.json:21-71). The schema contains no matching runtime queries because Supabase is not used by the application code.

## 2. Feature inventory

| Feature | Implemented in (file) | Status | Evidence |
|---|---|---|---|
| Automatic first-channel playback and HLS/native URL selection | `js/player.js`, `index.html` | At risk | `loadChannels()` invokes `playChannel(0)`; playback is direct to channel URL (js/player.js:316-355, 653-692). |
| Channel grid, logos, active channel marker, drawer | `index.html`, `js/player.js`, `css/player.css` | At risk | Grid rendered from all filtered channels; cards use remote logos (index.html:74-94; js/player.js:389-413). |
| Categories/filtering | `js/player.js`, `css/player.css` | Broken | Handler expects `#category-bar`, but there is no such element in current `index.html`; checked-in data assigns all 82 channels to `General` (js/player.js:38, 1295-1305; data/channels.json:1-821). |
| Player buffering/error message, manual retry, next channel | `index.html`, `js/player.js` | At risk | Waiting/playing/video-error handlers and retry/next buttons exist; fatal network errors do not reach the terminal error path (index.html:56-68; js/player.js:416-437, 509-556, 1338-1346). |
| HLS network/media recovery and optional backup URL | `js/player.js` | At risk | Handles fatal network/media errors; backup is only read from `backup_url`/`backupUrl`, which admin save does not persist (js/player.js:477-555; api/channels.js:149-159). |
| Android TV/keyboard arrows, focus, channel zap, OK, Back | `js/player.js`, `css/player.css` | At risk | Arrows open/navigate drawer or zap while closed; focus ring is high contrast; Back closes drawer then returns to host (js/player.js:945-1000, 1015-1164; css/player.css:654-706). |
| Mobile swipe drawer | `js/player.js` | OK | Swipe up/down on video wrapper opens/closes drawer (js/player.js:1170-1223). |
| Viewport-sized player stage | `css/player.css` | At risk | Fixed stage is always 100vw x 100vh; no native Fullscreen API or fullscreen-change handling found (css/player.css:113-132; js/player.js; index.html). |
| Pause/play, mute/volume keyboard commands, PiP | `js/player.js`, `index.html` | At risk | Remote/media keys control playback and audio; native bridge and browser PiP are attempted (js/player.js:1129-1155, 1318-1335). No visible sound/play control is present in the markup. |
| VIP customer code/PIN check, device registration and live access check | `index.html`, `js/player.js`, API files | At risk | Login posts customer and device details; periodic channel API check can stop playback (index.html:101-120; js/player.js:1360-1493). |
| Version check, update prompt, forced update, APK download | `index.html`, `js/player.js`, `api/version.js`, `data/version.json` | At risk | Version API called after channel load; force-update modal and Android bridge download supported (js/player.js:205-310; data/version.json:1-15). |
| Notice ticker and ad slots | `index.html`, `js/player.js`, `api/settings.js` | At risk | Settings toggle notice and insert ad HTML into slots (index.html:15-23; js/player.js:83-135). |
| Admin login/session UI | `admin.html`, `js/admin.js`, `api/auth.js` | Broken | Login panel and server endpoints exist, but bearer tokens are unsigned Base64 strings and trivially forgeable (admin.html:11-27; js/admin.js:46-89; api/auth.js:87-125). |
| Admin channel search, add/edit/delete, pin, reorder, status | `admin.html`, `js/admin.js`, `api/channels.js` | At risk | Search/table/actions and CRUD forms/API exist; write success can be returned despite failed GitHub persistence (admin.html:116-185, 484-526; js/admin.js:202-480). |
| Admin live preview | `admin.html`, `js/admin.js` | At risk | Preview modal creates HLS or native playback (admin.html:528-540; js/admin.js:389-438). |
| M3U/JSON import, test/diagnose, manual refresh, saved playlist list/delete, M3U export | `admin.html`, `js/admin.js`, `api/playlist.js`, `api/playlists.js` | At risk | Import form, test/diagnose, refresh and export flows are present (admin.html:186-302; js/admin.js:588-905). |
| Health scan and client auto-detector | `admin.html`, `js/admin.js`, `api/health.js` | At risk | Batch scan and one-channel browser probe exist; server scan can label 404 responses ONLINE (admin.html:127-163; js/admin.js:906-948, 1495-1553; api/health.js:38-68). |
| Customer create/edit/delete, block, subscription renewal | `admin.html`, `js/admin.js`, `api/customers.js`, `api/subscriptions.js` | At risk | Customer table/modal and renewal calls exist (admin.html:304-330, 548-588; js/admin.js:948-1033). |
| Device list/block/unblock/delete | `admin.html`, `js/admin.js`, `api/devices.js` | At risk | Device controls exist; customer-scoped GET is not admin-protected (admin.html:332-382; js/admin.js:1088-1168; api/devices.js:31-35). |
| Active-connection/activity dashboard | `admin.html`, `js/admin.js`, `api/activity.js` | At risk | Heartbeats every 25s and admin polling every 8s, but state is in-memory and resets with function instances (js/player.js:76-79; js/admin.js:164-184, 1034-1086; api/_db.js:522-551). |
| Security/settings, subscription toggle, ads, notice | `admin.html`, `js/admin.js`, `api/settings.js` | At risk | Settings are read and written via API; token verification is weak (admin.html:384-440; js/admin.js:1232-1355; api/settings.js:19-44). |
| APK/version control | `admin.html`, `js/admin.js`, `api/version.js` | At risk | Version form updates metadata and APK URL (admin.html:441-470; js/admin.js:1357-1387; api/version.js:17-49). |

## 3. Issues list

Checked-in channel-data findings (`data/channels.json:1-821`): 82 channels; no case-insensitive duplicate names or exact duplicate URLs; no empty names or missing logo fields; all top-level URLs are HTTPS and contain `.m3u8`; all 82 categories are `General`. URL/image contents were not fetched. One apparent channel/stream mismatch is `Zee Bangla Sonar` pointing at a `ColorsHD` path (data/channels.json:213-215). Seven URLs contain explicit expiry/signature parameters with expiry timestamps of June 28, 2026 (examples at data/channels.json:325, 335, 465, 485, 495, 545, 555); as of the audit date those are expired. Values are intentionally not reproduced. The live `data-storage` branch may differ.

### Critical

1. **Admin authorization can be forged without credentials.** Evidence: `api/auth.js:87-96` issues a Base64-encoded string containing a recognizable prefix and timestamp, with no signature or server-side session; `api/auth.js:110-125` trusts the decoded prefix; the shared verifiers in `api/channels.js:4-19` and equivalent API files do the same. `api/channels.js:34-40` even treats any matching prefix as admin. A crafted bearer value grants channel/customer/device/settings/version/playlist administration. The timestamp logic also permits expired tokens for up to another 24 hours; email is optional in the login check (`api/auth.js:79-85`). **User impact/root cause:** an unauthenticated caller can alter the service and its public content because “session” is only reversible encoding.

### Major

1. **Plaintext credentials and customer PINs are committed.** Evidence: `data/settings.json:3-5` contains admin credentials (values masked here); `data/customers.json:1-17` contains a customer PIN; `_db.js` also defines default admin credentials and a default customer PIN (api/_db.js:36-41, 410-430). The API settings response removes credential properties (api/settings.js:11-16), but `vercel.json:13` routes arbitrary paths to root files, so direct public access to `/data/settings.json` and `/data/customers.json` must be checked on the deployment (**unverified**). README also documents a default credential (README.md:29-30, 78-79). **Impact/root cause:** source/repository or static-file exposure reveals usable defaults and customer secrets; values are stored/compared as plaintext. Rotate them and verify deployed file access.
2. **Playlist importer is an SSRF primitive and disables TLS verification.** Evidence: `fetchUrl()` accepts the supplied URL, follows up to five redirects, uses `rejectUnauthorized: false`, and has only a 12-second timeout (api/playlist.js:25-56); POST supplies that URL directly (api/playlist.js:219-238). No scheme/host/private-address allowlist or response-size limit exists. **Impact/root cause:** the server can be induced to request internal or unintended hosts and parse/hold large responses; the forged admin token makes this reachable without a real login.
3. **Stored HTML injection/XSS reaches public viewers and admin pages.** Evidence: channel data is interpolated into player `card.innerHTML` including `ch.name` and `ch.logo` (js/player.js:391-402); version changelog uses `innerHTML` (js/player.js:270-276); admin channel rows interpolate channel values (js/admin.js:202-246), and ads intentionally use `innerHTML` (js/player.js:104-135). Playlist parsing accepts externally supplied names/logos (api/playlist.js:60-143). **Impact/root cause:** crafted or compromised imported content can execute script in visitors’ origin; dynamic values are not escaped/sanitized.
4. **Expired signed channel URLs have no token renewal/fallback.** Evidence: seven checked-in URLs have expired `e`/signature parameters (data/channels.json:325, 335, 465, 485, 495, 545, 555). Playback reuses the saved URL, removing only a `nocache` parameter (js/player.js:678-690); there is no expiry refresh. Admin `action=refresh` can update URLs only when a human triggers refresh from a saved playlist (api/playlist.js:255-311; js/admin.js:870-905). **Impact/root cause:** affected channels predictably return authorization errors and cannot recover automatically.
5. **Fatal network errors can reconnect indefinitely and leave a spinner.** Evidence: non-fatal stall calls `startLoad()` without a watchdog (js/player.js:477-483); fatal network errors restart loading, then re-call `playChannel()` after two seconds, resetting local counters (js/player.js:509-542). Media recovery also loops after resetting its counter (js/player.js:544-553). The buffering overlay is cleared on playback or `showError()`, but fatal network recovery does not display a terminal error (js/player.js:416-437, 1622-1630). No current channel has a saved backup, and the channel POST whitelist omits backup fields (api/channels.js:149-159). **Impact/root cause:** a dead URL, CORS error, or unstable network can repeatedly reconnect while users see buffering/reconnecting instead of a resolved error.
6. **Cold start performs sequential API/GitHub reads with no explicit timeout/cache policy.** Evidence: page startup awaits settings before channels (js/player.js:65-73); channel API awaits settings before channel data (api/channels.js:40-112); data misses call GitHub Contents API (api/_db.js:68-110, 146-160) with only a 20-second per-instance cache (api/_db.js:23, 57-60) and no request timeout (`githubRequest`, api/_db.js:68-96). There are no explicit API cache headers in `vercel.json:21-71`. **Impact/root cause:** cold instances and sequential round trips add launch delay; a slow GitHub request can run until the platform terminates it.
7. **No application stream proxy means CORS/host policy is a hard playback dependency.** Evidence: player assigns the channel URL directly to HLS.js or `video.src` (js/player.js:678-692); `server.js` maps API JSON/M3U routes only and has no stream/segment proxy (server.js:9-21, 86-103). `/api/playlist` imports or emits M3U; it does not proxy playback segments (api/playlist.js:162-212). **Impact/root cause:** a host that blocks browser CORS, referrer, or WebView requests fails on the user’s device; the API CORS headers do not grant CORS to third-party stream hosts.
8. **Health scan can call broken streams ONLINE.** Evidence: `pingStream()` treats every status from 200 through 499 as ONLINE, including 404, and only sends HEAD (api/health.js:38-68). Client scan can also mark a stream ONLINE as soon as the manifest parses/level loads, before proving a segment plays (js/admin.js:1495-1553). Public channel filtering trusts stored `status === 'ONLINE'` (api/channels.js:111-115). **Impact/root cause:** stale or unplayable channels remain published as ONLINE, contradicting user-visible health.
9. **Writes may return success when GitHub persistence failed.** Evidence: `saveChannel()` records `ok` but returns the channel regardless (api/_db.js:185-198); settings/version updates return merged data after ignored `ok` (api/_db.js:338-349, 727-739); playlist import ignores `db.importChannels()`’s boolean (api/playlist.js:362-379). Handlers then return 200/success (api/channels.js:157-162; api/playlist.js:375-385). **Impact/root cause:** admin sees “saved” but the `data-storage` branch and later player loads may still have old data.
10. **Customer-scoped device data is publicly readable.** Evidence: `GET /api/devices?customer_id=...` bypasses `verifyAdminToken()` (api/devices.js:31-35); the handler returns device records from `_db.js` (api/_db.js:524-539), including fingerprints, device metadata and stored IP. **Impact/root cause:** a customer ID is sufficient to query sensitive device history without admin auth.

### Minor

1. **Category controls/data do not line up.** The player has a handler for a `#category-bar` that is absent from `index.html`; all 82 checked-in channels are `General`, while the admin category select offers other fixed choices (js/player.js:38, 1295-1305; index.html:74-94; data/channels.json:1-821; admin.html:484-501). Categories cannot currently be meaningfully browsed in the player.
2. **DASH import is advertised but not implemented as a player engine.** Import parsing recognizes `.mpd` (api/playlist.js:109-143), but player selects HLS.js only for HLS-like URLs and otherwise sets `video.src` (js/player.js:678-692); there is no DASH library in `package.json` or the page. DASH playback is therefore browser-dependent and unverified.
3. **HLS.js is an unpinned, synchronous third-party dependency.** Both HTML pages load `@latest` in the head with no `async`/`defer` or integrity pin (index.html:8-10; admin.html:6-8). A CDN/version change or outage can block parsing; `playChannel()` also calls `Hls.isSupported()` directly (js/player.js:684). Exact library version is **unverified**.
4. **Fullscreen is a viewport stage, not native fullscreen.** CSS fixes the stage to 100vw/100vh, but there is no `requestFullscreen`, `exitFullscreen`, or `fullscreenchange` handler; Escape/Back only closes the drawer and then falls through to the host (css/player.css:113-132; js/player.js:1015-1164, 1637-1670). Native Android host behavior is **unverified**.
5. **The APK and current web assets are not the same build.** The two APK copies match each other, but the APK’s embedded `assets/index.html`, `assets/js/player.js`, and `assets/css/player.css` differ from the current root files; embedded JS reports `INSTALLED_APP_VERSION = 121` and has `backBufferLength: 15`, `fragLoadingMaxRetry: 6` (APK: embedded `assets/js/player.js:5, 418-431`), while current web JS is version 123 with 10 and 5 (js/player.js:5, 444-463). The checked-in update snapshot is version 123 and `forceUpdate: true` (data/version.json:1-15). Exact installed APK version/native WebView behavior is **unverified**.
6. **Playback reports are volatile and not surfaced in the current UI.** The endpoint accepts public reports, but `_db.js` stores them only in a module-level array (api/report.js:38-52; api/_db.js:686-700); no player report form or admin report tab was found. Reports disappear with function-instance changes.

## 4. Buffering root-cause ranking

| Rank / factor | Current value/evidence | Likely impact | Recommendation vs current | Expected gain |
|---|---|---|---|---|
| 1. Serial page bootstrap + cold GitHub source | `loadSettings()` then `loadChannels()` are awaited serially (js/player.js:65-73); API loads settings then channels (api/channels.js:40-112). `_db` cache is 20 seconds per process, not shared (api/_db.js:23, 57-60); GitHub request has no timeout (api/_db.js:68-96). | **High** startup | Collapse public startup data into one bounded response or load independent public settings/channel data concurrently; add explicit GitHub timeouts and cache public channel responses at the edge with VIP-aware cache rules. | Removes at least one browser/server sequential wait and reduces cold-origin calls; bounded failure avoids indefinite startup. |
| 2. Expired URL signatures and no refresh | Seven current snapshot URLs expire June 28, 2026 (data/channels.json:325, 335, 465, 485, 495, 545, 555); player retries the same URL (js/player.js:509-542, 678-690). | **High** no-start / repeated reconnect | Replace stale URLs with stable sources or a server-side refresh mechanism; store alternate URLs and validate their manifests before publishing. No automatic refresh exists today. | Restores affected channels and prevents retries against permanently unauthorized URLs. |
| 3. Unbounded fatal recovery and missing no-progress watchdog | HLS non-fatal stall restarts `startLoad`; fatal network errors repeatedly reload same channel; media recovery resets counter (js/player.js:477-553). | **High** rebuffer / spinner | Bound recovery (for example 2-3 retries with explicit backoff), add a no-progress deadline, attempt a valid backup once, then show an actionable error and stop loading. | Stops endless spinner/reconnect cycles and makes failures diagnosable; does not by itself improve an unavailable source. |
| 4. Buffer targets and opaque ABR defaults | Current HLS: `maxBufferLength: 30s`, `maxMaxBufferLength: 60s`, `backBufferLength: 10s`, `lowLatencyMode: false`, `enableWorker: true`, `maxBufferSize: 60 MiB`, `maxBufferHole: 0.5`, `highBufferWatchdogPeriod: 2`, `nudgeOffset: 0.1`, `nudgeMaxRetry: 5`, `startFragPrefetch: true`, `autoStartLoad: true` (js/player.js:444-463). | **Medium** latency/memory and recovery behavior | Measure representative feeds, then test a lower live target (e.g. 10-15s max buffer and 20-30s ceiling), retain back-buffer near 10s, and explicitly configure a supported live sync target. Do not enable low-latency mode unless the source supports it. | Less queued live video and lower memory/latency on tested feeds; startup gain is source/network dependent, not guaranteed. |
| 5. Retry timeout/default drift | Fragment timeout 20,000ms, manifest timeout 15,000ms; fragment/manifest/level max retries each 5 (js/player.js:455-459). Retry delays, `levelLoadingTimeOut`, `startLevel`/`autoLevelStart`, `capLevelToPlayerSize`, `liveSyncDurationCount`, and `liveMaxLatencyDurationCount` are not set. Defaults are **unverified** because CDN is `@latest` (index.html:10). | **Medium** | Pin HLS.js; explicitly set supported retry delays/timeouts and bounded retries; test `capLevelToPlayerSize: true` and a measured startup/ABR policy. | Reproducible ABR and shorter failure detection; avoids unexpectedly high rendition selection on small/slow devices. |
| 6. Render/network competition before playback | All 82 cards are rendered at once (js/player.js:389-413), with one external logo image each and no `loading="lazy"`; HLS.js is a synchronous head script (index.html:8-10). | **Medium** on low-end TV/mobile | Lazy-load/virtualize off-screen cards and pin/defer the HLS bundle without delaying player initialization. | Fewer concurrent logo requests and less initial parsing/layout contention. |

### Stall recovery, startup, ABR, and server findings

- `BUFFER_STALLED_ERROR` is handled only when non-fatal, by restarting loading; fatal NETWORK and MEDIA errors have separate recovery. There is no wall-clock “no progress” watchdog. `waiting` shows the spinner; `playing` and `timeupdate` hide it; generic video error shows an error overlay (js/player.js:416-437, 477-553).
- Startup has two serial browser API requests before first stream selection: settings, then channels (js/player.js:65-73). On cold API instances, GitHub fetches can add one settings read and one channel read; VIP mode can add customer/device reads (api/channels.js:40-112; api/_db.js:68-110). The first stream needs its manifest/playlist and at least one media segment; master playlists may add rendition-playlist requests. Exact count and time-to-first-frame are source-dependent and **unverified**.
- Channel data is not fetched per click; only initial page load and a later full reload fetch the player’s channel list. VIP checks run every 30 seconds but do not replace the client’s list (js/player.js:316-355, 1494-1520).
- `startLevel` and player-size cap are not configured. HLS.js auto-ABR/default behavior is version-dependent; “starts lowest” versus “starts too high” is **unverified**. The CDN is unpinned, so default retry-delay values also cannot be reliably named.
- There is no app streaming proxy. Consequently no proxy path can preserve incoming Range headers or pass upstream playlist/segment headers; the player requests third-party hosts directly. `/api/download` streams the APK but does not implement Range (api/download.js:31-41). No explicit Node compression exists in `server.js`; Vercel edge compression behavior is **unverified**.
- `vercel.json` does not set `s-maxage` or `stale-while-revalidate` for APIs/data; HTML/JS/CSS are configured no-store (vercel.json:21-71). `_db.js` is the only explicit data cache and is a 20-second in-process cache.
- The channel drawer eagerly inserts the entire list; each card creates a wrapper, image, title, and card node (roughly 328 card-related elements for 82 entries, plus wrappers). External logo file dimensions/transfer sizes are **unverified**. Player CSS applies `will-change: transform, opacity` to each card/grid (css/player.css:3-8); blur properties in the player CSS are commented out, so an active blur layer over video was not found. The admin stylesheet does use backdrop blur, but not over the public video (css/admin.css:43-49).

## 5. Fix plan

1. **Replace forgeable admin sessions and rotate all secrets** — `api/auth.js`, every API verifier (or a shared auth helper), `js/admin.js`, `data/settings.json`, `data/customers.json`, `api/_db.js`, `README.md`, deployment environment. Use signed, expiring sessions; require the email; move secrets out of tracked/static files; hash customer PINs; revoke exposed defaults. **Highest impact; do before any other admin-side changes.**
2. **Escape/sanitize dynamic content** — `js/player.js`, `js/admin.js`, `api/playlist.js`, settings/ad handling. Render untrusted names, URLs, changelogs, and playlist metadata as text or validate against safe URL/HTML policies.
3. **Repair stream source lifecycle** — `data/channels.json` and remote `data-storage` channel data; `api/playlist.js`; `api/channels.js`; `js/player.js`. Replace expired signed URLs, add controlled renewal/fallback, and define/persist a validated backup URL if supported.
4. **Bound player recovery and report terminal errors** — `js/player.js`. Add finite retry/backoff, watchdog, per-channel recovery reset, and a final retry/next-channel error state; ensure fatal retries do not reset into an infinite loop.
5. **Make startup bounded and cache-safe** — `js/player.js`, `api/channels.js`, `api/settings.js`, `api/_db.js`, `vercel.json`. Remove serial public fetch dependency where safe; add backend timeouts and public-only cache headers; do not cache VIP responses across users.
6. **Correct stream health detection** — `api/health.js`, `js/admin.js`. Treat 404/4xx as failed, test manifest plus a media segment (and device/browser CORS where feasible), and keep probe status separate from verified playback status.
7. **Surface persistence errors** — `api/_db.js`, `api/channels.js`, `api/playlist.js`, `api/settings.js`, `api/version.js`, related admin UI. Return explicit non-2xx JSON on failed commits and avoid caching unpersisted changes as success.
8. **Protect device APIs and minimize customer data exposure** — `api/devices.js`, `api/customers.js`, `js/player.js`. Require authenticated customer proof for device lookups/registration; avoid PINs in query strings and minimize returned IP/fingerprint data.
9. **Align catalog and player capabilities** — `data/channels.json`, `admin.html`, `index.html`, `js/player.js`, `api/playlist.js`. Correct channel/logo/category assignments, add a real category control if desired, and reject formats the player cannot play or add a supported DASH engine.
10. **Pin and validate the player build** — `index.html`, `admin.html`, `package.json`, Android APK build pipeline and `data/version.json`. Pin HLS.js, test supported config/defaults, rebuild APK from the same player source, and verify forced-update metadata against the actual artifact.
11. **Add integration checks for deployed contracts** — focused tests for API auth, storage failure, channel URL validation, retry termination, player rendering safety, VIP/device authorization, and static-file secret exposure. `package.json` currently has no test command.

## 6. Needs live testing

- Verify the actual deployed GitHub `data-storage` branch’s channel/settings/version contents and compare them with this checkout; inspect whether `/data/settings.json` and `/data/customers.json` are publicly retrievable from Vercel without exposing their values in logs.
- From browser and Android TV WebView, test the seven expired signed URLs and all current stream manifests/segments; record HTTP status, CORS headers, referer requirements, geoblocking, first-frame time, and rebuffer frequency over a representative session.
- Measure a cold Vercel page load and warm load with a network waterfall: `/api/settings`, `/api/channels`, GitHub calls, manifest/variant playlist/segment count, and p50/p95 time to first frame.
- Force a 404, CORS denial, network loss, segment stall, media decode error, and token expiry; confirm whether the spinner clears, retries are finite, an alternate URL is used, and a useful error appears.
- Test unauthorized API calls with no token and forged token-shaped strings; confirm every admin endpoint rejects them after the auth fix. Test `/api/devices?customer_id=...`, customer PIN handling, and Range/HEAD behavior without exposing real customer data.
- Confirm actual deployed cache/compression/security headers and local-vs-Vercel behavior for `/api/download`, `/download.apk`, and unknown API/static paths.
- On physical Android TV and mobile browsers, test remote arrows/OK/Back/Escape, opening/closing the drawer while playback continues, host/native fullscreen behavior, focus visibility, picture-in-picture, and whether the shipped APK’s embedded assets match the intended build.
- Verify logo images visually, especially `Zee Bangla Sonar`, and check actual image file sizes and failures; source URLs alone do not prove image identity or availability.
- Confirm whether active-connection analytics and playback reports are expected to survive Vercel instance changes; code alone shows process-local storage, not production behavior.
