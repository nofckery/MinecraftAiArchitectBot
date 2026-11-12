# Project: Minecraft Bot & Architect Mission Control Dashboard Overhaul

## Architecture
- **Web Frontend**: Vanilla HTML5, Modern CSS (Grid + Flexbox + Custom Properties), Three.js CAD Viewport (`src/web/public/js/threeViewport.js`), Dashboard Controller (`src/web/public/app.js`), Index View (`src/web/public/index.html`), Global Stylesheet (`src/web/public/style.css`).
- **Data Flow & Interfaces**:
  - 3-Column Dashboard Layout: Left column (Bot status, camera, map, inventory), Center column (CAD World Studio & Three.js canvas), Right column (Architect chat, blueprints, build queue, settings).
  - CAD Studio Internal Hierarchy: Header / Scan Bar (`#cadWorldScanBar`), Compact Toolbar (`.three-toolbar`), Main CAD Area (Canvas Container `#threeContainer` + Sidebar `#cadStudioSidebar`), Sticky Action Footer (`.build-actions-bar`).
  - Bot Camera & 2D Map: Port 3081 iframe (`#viewerFrame`) with Reachability Probe and Offline Fallback Card (`#viewerOfflinePlaceholder`).
  - Fullscreen Overlay: Class `.cad-studio-fullscreen` applied to `#columnCadStudio` or `#panelCadStudio`, expanding to `100vw` / `100vh` with `position: fixed; z-index: 9999;` and responsive canvas resize via `ResizeObserver`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | 3D-CAD-Viewport Maximization (F1) | Rebalance 3-column grid (e.g. 25% 52% 23%), compact toolbar rows, reclaim vertical space, expand canvas area | M1 | Survey (R1) |
| 2 | Action Bar & Control Visibility (F2) | Pin `.build-actions-bar` as sticky/flex footer, ensure `#btnStartSceneBuildQueue`, `#btnConfirmBuild`, `#btnStopBuild` are never clipped or cut off | M1 | Survey (R1, R4) |
| 3 | CAD Sidebar Tabbed/Compact Layout (F3) | Tabbed navigation for `#cadStudioSidebar` (`[🗂️ Objekte] [📐 Inspektor] [🧠 Spatial KI]`) to prevent internal scrolling and canvas compression | M1 | Survey (R1, R4) |
| 4 | True 100vw/100vh Fullscreen Mode (F4) | Fix `.cad-studio-fullscreen` CSS selectors, remove `calc(100vh - 250px)` height cap, full window coverage | M2 | Survey (R2) |
| 5 | Shortcut [F] & Button Toggle Ergonomics (F5) | Support `#btnToggleCadFullscreen` and [F] shortcut with proper event filtering (no Ctrl/Alt/Meta, ignore `<input>/<select>/<textarea>`, guard against gamemode conflict) | M2 | Survey (R2) |
| 6 | Three.js Distortion-Free Resize & State Restore (F6) | Bind `ResizeObserver` on `#threeContainer`, maintain camera aspect ratio & projection matrix, update devicePixelRatio, restore user's prior layout on exit | M2 | Survey (R2) |
| 7 | Bot-Cam Offline Fallback Status Card (F7) | Replace native browser ERR_CONNECTION_REFUSED with styled `#viewerOfflinePlaceholder` card showing connection status, explanation, and animated pulse | M3 | Survey (R3) |
| 8 | Bot-Cam Reachability Probe & Retry Action (F8) | Probe port 3081 / bot state before loading iframe, provide interactive Retry / Refresh button to reconnect without page reload | M3 | Survey (R3) |
| 9 | Test Suite Compatibility Forwarder (F9) | Ensure `tests/cadWorldStudioPerfectionTest.js` executes reliably alongside `test/cadWorldStudioPerfectionTest.js` | M4 | Survey (Verification) |
| 10 | Comprehensive Regression & Perfection Validation (F10) | Pass 100% of unit, syntax, and E2E test suites with zero layout clipping or console errors | M4 | Survey (Acceptance) |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Dashboard Layout & Viewport Ergonomics | F1, F2, F3: Grid rebalance, toolbar compaction, action bar pinning, sidebar tabbed organization | none | DONE (Gate passed, 30/30 suites pass, clean audit) |
| M2 | Fullscreen Mode & Three.js Canvas Adaptation | F4, F5, F6: True fullscreen CSS, ResizeObserver, keyboard shortcut safeguards, state restoration | M1 | DONE (Gate passed, 93/93 E2E tests, 364/364 stress tests, clean audit) |
| M3 | Bot-Cam Offline Fallback UX | F7, F8: Offline status card, reachability probe, retry/refresh button | none | IN_PROGRESS (sub_orch: 94d235aa-41ee-4770-93d5-956b4ae0d77a) |
| M4 | E2E Perfection Verification & Coverage Hardening | F9, F10: Test compatibility, 100% E2E test suite pass, adversarial coverage hardening | M1, M2, M3 | PLANNED |

## Interface Contracts
### CAD Studio Container ↔ Three.js Viewport
- Container: `#threeContainer` inside `#panelCadStudio` (`#columnCadStudio`).
- Event Contract: Whenever `#threeContainer` dimensions change (via window resize, fullscreen toggle, or sidebar collapse), a `ResizeObserver` triggers `resizeThreeViewport()`.
- Resize Contract: `resizeThreeViewport()` reads `clientWidth` and `clientHeight` of `#threeContainer`, updates `renderer.setSize(w, h, false)`, `renderer.setPixelRatio(window.devicePixelRatio)`, `camera.aspect = w / h`, and calls `camera.updateProjectionMatrix()`.

### Fullscreen Controller ↔ State Storage
- Function: `toggleCadStudioFullscreen(forceState)` in `app.js`.
- State Contract: Before entering fullscreen, store prior collapsed/expanded state of `#cadStudioSidebar` and `#cadWorldScanBar` in memory. On exit, restore exact prior states.
- Class Contract: Toggle `.cad-studio-fullscreen` on the outer CAD container (`#columnCadStudio` / `#panelCadStudio`).

### Bot Camera Container ↔ Offline Fallback
- Container: `#viewerContainer` in `src/web/public/index.html`.
- Elements: `#viewerFrame` (iframe) and `#viewerOfflinePlaceholder` (fallback card).
- Status Contract: When bot/viewer is offline (or port 3081 unreachable), `#viewerFrame` has `src="about:blank"` and `display: none;`, while `#viewerOfflinePlaceholder` has `display: flex;`.
- Action Contract: `#btnRetryViewerConnection` triggers an active connection check, showing loading indicator and reconnecting if port 3081 becomes active.

## Code Layout
- `src/web/public/index.html`: DOM structure for 3-column layout, CAD studio, scan bar, action footer, and offline fallback placeholder card.
- `src/web/public/style.css`: Grid definition, responsive CAD column, sticky action bar, `.cad-studio-fullscreen` styles, scan bar styles, fallback card styles.
- `src/web/public/app.js`: Fullscreen toggle logic, keyboard event listener, camera probe and offline fallback handler, sidebar state restoration.
- `src/web/public/js/threeViewport.js`: Three.js viewport initialization, `ResizeObserver`, aspect ratio & projection matrix update logic.
- `tests/cadWorldStudioPerfectionTest.js` & `test/cadWorldStudioPerfectionTest.js`: Automated regression and perfection test harnesses.
