# Test Infrastructure & Quality Assurance Architecture
**Project:** Minecraft Bot & Architect Mission Control Dashboard Overhaul  
**Document Version:** 1.0.0  
**Status:** Active / Authoritative Specification  

---

## 1. Executive Summary & Purpose

This document establishes the authoritative test architecture, testing philosophy, partition methodologies, and execution specifications for verifying the Minecraft Bot & Architect Mission Control Dashboard overhaul.

The dashboard overhaul focuses on four primary functional domains:
1. **CAD-Studio Layout & Viewport Maximization (F1–F3)**: Ergonomic 3-column layout rebalancing, sticky/pinned action bars, and tabbed sidebar navigation.
2. **True Fullscreen Mode & Ergonomics (F4–F5)**: 100vw/100vh viewport expansion, keyboard shortcut `[F]` and button controls, input/gamemode event filtering.
3. **Three.js Distortion-Free Adaptation (F6)**: Responsive canvas re-adaptation via `ResizeObserver`, aspect ratio & projection matrix recalculation, state preservation on exit.
4. **Bot-Cam Offline Fallback & Probe Engine (F7–F8)**: Graceful offline placeholder card, automated port 3081 reachability probe, and interactive retry reconnection.

To guarantee zero regression, total reliability, and strict adherence to requirements, the test suite is partitioned into four progressive tiers comprising **93 automated test cases**, operating completely without external npm dependencies.

---

## 2. Test Philosophy

### 2.1 Opaque-Box & Behavioral Verification
Tests interact exclusively through public element selectors, standard DOM events, HTTP probe interfaces, and exported module APIs. Tests treat internal module implementations as opaque, verifying observable outputs:
- DOM structure, attribute changes, class mutations, and CSS layout states.
- Event dispatching, keydown propagation, and filtering boundaries.
- Canvas resizing, aspect ratio calculations, and projection matrix triggers.
- Reconnection states, error messaging, and button loading spinners.

### 2.2 Requirement-Driven Coverage
Every test case maps directly back to the requirements defined in `ORIGINAL_REQUEST.md` (R1–R4) and the feature specifications in `PROJECT.md` (F1–F8). No test exists without a corresponding requirement source.

### 2.3 Zero External Dependencies
The entire testing harness and all test suites are implemented in pure Node.js (>=20.0.0) using native ES Modules (`"type": "module"`), native assertions (`node:assert/strict`), and built-in Node.js libraries (`node:fs`, `node:path`, `node:events`, `node:http`, `node:url`). No external npm testing libraries (such as Jest, Mocha, or jsdom) are permitted. Lightweight, high-performance mock DOM and Three.js fixtures reside in `tests/helpers/`.

### 2.4 Determinism & Rapid Execution
- All tests are isolated and self-contained; execution order independence is mandatory.
- Mock environments are reset in `beforeEach` / `afterEach` hooks to prevent cross-test contamination.
- Full execution of all 93 tests completes in under 5 seconds.

---

## 3. Test Methodology & Partitioning Techniques

The test suite applies four formal software testing methodologies to guarantee robust coverage:

### 3.1 Category-Partition Method
Each feature's input domain and environment state are partitioned into disjoint categories:
- **Display Mode**: Normal 3-column layout vs. Fullscreen (`.cad-studio-fullscreen`).
- **Sidebar State**: Expanded (`objects`, `inspector`, `spatial`) vs. Collapsed.
- **Connection State**: Port 3081 online (active stream) vs. offline / refused vs. timed out vs. HTTP 500.
- **Input Context**: Global body focus vs. editable elements (`<input>`, `<textarea>`, `contenteditable`) vs. active manual gamemode.

Equivalence classes are sampled to ensure valid, boundary, and invalid inputs are tested without redundant overlap.

### 3.2 Boundary Value Analysis (BVA)
BVA targets the critical limits where systems frequently fail:
- **Geometry & Dimension Boundaries**:
  - `0px` client height (zero-dimension safeguard).
  - Minimum viewport dimensions (`320px` mobile/docked limit vs. `3840px` 4K ultrawide).
  - Fractional container widths (e.g., `1024.7px`).
- **Aspect Ratio Extremes**:
  - Extreme ultrawide (`32:9`) to extreme portrait (`9:32`).
- **Event Frequency Boundaries**:
  - Burst resize events (50 rapid triggers).
  - Rapid double-clicks on `#btnConfirmBuild` and `#btnRetryViewerConnection`.
  - Holding down shortcut `[F]` (`event.repeat = true`).

### 3.3 Pairwise & Cross-Feature Interaction Testing (Tier 3)
Features do not operate in isolation. Tier 3 evaluates orthogonal feature combinations:
- **F1 + F4**: 3-Column Grid transition to 100vw Fullscreen overlay.
- **F4 + F6**: Fullscreen entry triggering `ResizeObserver` and aspect ratio recalculation; exit restoring exact original dimensions.
- **F5 + F4 + F2**: Pressing shortcut `[F]` to enter fullscreen while verifying `.build-actions-bar` remains anchored, visible, and clickable.
- **F3 + F6**: Collapsing the CAD sidebar and verifying Three.js canvas dynamically reclaims horizontal width.
- **F5 + Gamemode**: Pressing `[F]` while in manual gamemode triggering Minecraft offhand action rather than CAD fullscreen.
- **F7 + F8**: Triggering Bot-Cam retry while cycling tabs between Camera and 2D-Map.
- **F2 + F3**: Expanding the full Spatial AI inspector panel without occluding or pushing the sticky action footer off-screen.
- **F4 + F7**: Entering CAD fullscreen without disrupting background Bot-Cam probe timers.

### 3.4 Workload & Scenario Testing (Tier 4)
Tier 4 executes realistic, multi-step user workflows modeling real-world user sessions from boot to mission completion:
- **T4.1 Architect CAD Session**: Boot -> Expand fullscreen -> Select Spatial AI -> Generate smart path -> Queue build -> Exit fullscreen.
- **T4.2 Camera Outage & Recovery Cycle**: Boot with port 3081 unreachable -> View fallback card -> Click Retry -> Port becomes online -> Iframe stream restores cleanly.
- **T4.3 Ergonomic Stress Sequence**: High-velocity interleaving of sidebar collapse, tab toggles, fullscreen toggles, and window resizes.
- **T4.4 Mode Transition Stability**: Clean switching between manual cockpit gamemode and CAD World Studio.
- **T4.5 Compatibility Forwarder & Full Regression**: Running `tests/cadWorldStudioPerfectionTest.js` alongside `test/cadWorldStudioPerfectionTest.js` and verifying 100% pass across all 6 CAD perfection phases.

---

## 4. Feature Inventory & Mapping Matrix

| Feature ID | Feature Name | Description | Source | Tier 1 (Coverage) | Tier 2 (Boundaries) | Tier 3 (Interactions) | Tier 4 (Real-World) | Total Tests |
|---|---|---|---|---|---|---|---|---|
| **F1** | 3D-CAD Viewport Maximization | Rebalance 3-column grid (52% center), compact toolbars, reclaim vertical space, prevent canvas clipping | R1 | T1.1–T1.5 (5) | T2.1–T2.5 (5) | T3.1 | T4.1, T4.3 | 12 |
| **F2** | Action Bar & Control Visibility | Sticky footer pinning for `.build-actions-bar`, guarantee `#btnStartSceneBuildQueue`, `#btnConfirmBuild`, `#btnStopBuild` are never clipped | R1, R4 | T1.6–T1.10 (5) | T2.6–T2.10 (5) | T3.3, T3.7 | T4.1 | 12 |
| **F3** | CAD Sidebar Tabbed Layout | Tabbed navigation for `#cadStudioSidebar` (`Objects`, `Inspector`, `Spatial AI`), toggle collapse, state persistence | R1, R4 | T1.11–T1.15 (5) | T2.11–T2.15 (5) | T3.4, T3.7 | T4.1, T4.3 | 12 |
| **F4** | True 100vw/100vh Fullscreen Mode | Fullscreen overlay class `.cad-studio-fullscreen`, removal of height caps, body overflow locking, clean layout restoration | R2 | T1.16–T1.20 (5) | T2.16–T2.20 (5) | T3.1, T3.2, T3.8 | T4.1, T4.3 | 13 |
| **F5** | Shortcut [F] & Toggle Ergonomics | Button click `#btnToggleCadFullscreen` and `[F]` shortcut, modifier key guards, input/textarea filtering, gamemode offhand guards | R2 | T1.21–T1.25 (5) | T2.21–T2.25 (5) | T3.3, T3.5 | T4.1, T4.4 | 12 |
| **F6** | Three.js Distortion-Free Resize | `ResizeObserver` on `#threeContainer`, aspect ratio update, `camera.updateProjectionMatrix()`, `renderer.setSize()`, state restore | R2 | T1.26–T1.30 (5) | T2.26–T2.30 (5) | T3.2, T3.4 | T4.1, T4.3 | 12 |
| **F7** | Bot-Cam Offline Fallback Status Card | Replacement of browser connection errors with styled `#viewerOfflinePlaceholder` card, status info, animated pulse | R3 | T1.31–T1.35 (5) | T2.31–T2.35 (5) | T3.6, T3.8 | T4.2 | 11 |
| **F8** | Bot-Cam Reachability Probe & Retry | Port 3081 status probing, interactive `#btnRetryViewerConnection`, loading spinner indicator, stream reconnection | R3 | T1.36–T1.40 (5) | T2.36–T2.40 (5) | T3.6 | T4.2 | 11 |
| **F9/F10**| Compatibility Forwarder & Regression | `tests/cadWorldStudioPerfectionTest.js` forwarder, 6-phase perfection validation, syntax check | Verif. | - | - | - | T4.5 | 1 |
| **TOTAL** | | | | **40** | **40** | **8** | **5** | **93** |

---

## 5. Test Architecture & Directory Layout

```
d:\Minecraft Bot\
├── TEST_INFRA.md                                  # Authoritative Test Infrastructure Specification (This file)
├── tests/
│   ├── cadWorldStudioPerfectionTest.js            # Compatibility forwarder -> ../test/cadWorldStudioPerfectionTest.js
│   ├── runAllTiers.js                             # Master CLI test runner supporting --tier=N
│   ├── helpers/
│   │   ├── testHarness.js                         # Zero-dependency test suite runner, assert helpers & reporters
│   │   ├── mockDom.js                             # Headless Mock DOM (Document, Window, Element, Events, ClassList)
│   │   └── mockThree.js                           # Headless Mock Three.js (WebGLRenderer, PerspectiveCamera, ResizeObserver)
│   ├── tier1_features/                            # Tier 1: 40 Feature Coverage Tests
│   │   ├── t1_f1_viewport_maximization.test.js    # F1: 5 tests
│   │   ├── t1_f2_action_bar_visibility.test.js    # F2: 5 tests
│   │   ├── t1_f3_sidebar_tabbed_layout.test.js    # F3: 5 tests
│   │   ├── t1_f4_fullscreen_mode.test.js          # F4: 5 tests
│   │   ├── t1_f5_shortcut_ergonomics.test.js      # F5: 5 tests
│   │   ├── t1_f6_threejs_resize.test.js           # F6: 5 tests
│   │   ├── t1_f7_cam_offline_card.test.js         # F7: 5 tests
│   │   └── t1_f8_cam_probe_retry.test.js          # F8: 5 tests
│   ├── tier2_boundaries/                          # Tier 2: 40 Boundary & Edge Case Tests
│   │   ├── t2_f1_viewport_boundaries.test.js      # F1 boundaries: 5 tests
│   │   ├── t2_f2_action_bar_boundaries.test.js    # F2 boundaries: 5 tests
│   │   ├── t2_f3_sidebar_boundaries.test.js       # F3 boundaries: 5 tests
│   │   ├── t2_f4_fullscreen_boundaries.test.js    # F4 boundaries: 5 tests
│   │   ├── t2_f5_shortcut_boundaries.test.js      # F5 boundaries: 5 tests
│   │   ├── t2_f6_threejs_resize_boundaries.test.js# F6 boundaries: 5 tests
│   │   ├── t2_f7_cam_offline_boundaries.test.js   # F7 boundaries: 5 tests
│   │   └── t2_f8_cam_probe_boundaries.test.js     # F8 boundaries: 5 tests
│   ├── tier3_interactions/                        # Tier 3: 8 Cross-Feature Interaction Tests
│   │   └── t3_cross_feature_interactions.test.js  # 8 Pairwise integration tests
│   └── tier4_real_world/                          # Tier 4: 5 Real-World Application Scenarios
│       └── t4_real_world_scenarios.test.js        # 5 End-to-end workload tests
└── test/
    └── cadWorldStudioPerfectionTest.js            # Existing 6-phase perfection test suite
```

---

## 6. Detailed Test Specifications by Tier

### 6.1 Tier 1: Feature Coverage (40 Tests)

#### F1: 3D-CAD-Viewport Maximization
- **T1.1**: `test_f1_grid_ratio_allocates_majority_to_cad`: Verifies CSS grid template gives >=50% space to center column `#columnCadStudio`.
- **T1.2**: `test_f1_canvas_container_expands_to_fill_workspace`: Verifies `#threeContainer` expands to fill `.cad-studio-workspace` without fixed pixel clipping.
- **T1.3**: `test_f1_compact_toolbar_padding_and_layout`: Verifies `.three-toolbar` uses compact padding (<=8px) and flexible row layout.
- **T1.4**: `test_f1_vertical_reclaim_on_subbar_toggle`: Verifies vertical canvas bounds expand when `#cadWorldScanBar` is toggled.
- **T1.5**: `test_f1_container_minimum_bounds_safeguard`: Verifies min-width/min-height safeguards prevent zero-dimension canvas crashes.

#### F2: Action Bar & Control Visibility
- **T1.6**: `test_f2_action_bar_sticky_footer_positioning`: Verifies `.build-actions-bar` uses sticky or flex pinning at bottom of workspace.
- **T1.7**: `test_f2_start_scene_build_button_visible_and_unclipped`: Verifies `#btnStartSceneBuildQueue` is rendered, visible, and unclipped.
- **T1.8**: `test_f2_confirm_and_stop_buttons_rendered_and_clickable`: Verifies `#btnConfirmBuild` and `#btnStopBuild` are accessible in action bar.
- **T1.9**: `test_f2_action_bar_zindex_hierarchy`: Verifies action bar z-index layers above 3D canvas but below modal overlays.
- **T1.10**: `test_f2_workspace_padding_prevents_overlap`: Verifies workspace bottom clearance prevents action bar from occluding sidebar content.

#### F3: CAD Sidebar Tabbed Layout
- **T1.11**: `test_f3_tab_buttons_rendered_for_all_sections`: Verifies tab buttons exist for Objects (`#tabBtnObjects`), Inspector (`#tabBtnInspector`), and Spatial AI (`#tabBtnSpatial`).
- **T1.12**: `test_f3_tab_switching_activates_target_pane`: Verifies clicking a tab button activates corresponding pane and hides siblings.
- **T1.13**: `test_f3_sidebar_collapse_toggle_button`: Verifies collapse toggle button toggles `.collapsed` / `.hidden` on `#cadStudioSidebar`.
- **T1.14**: `test_f3_sidebar_collapse_widens_canvas`: Verifies collapsing sidebar increases clientWidth available to `#threeContainer`.
- **T1.15**: `test_f3_tab_selection_persists_across_collapse_cycles`: Verifies active tab selection is retained after sidebar collapse and expand cycle.

#### F4: True 100vw/100vh Fullscreen Mode
- **T1.16**: `test_f4_fullscreen_class_applies_fixed_full_screen`: Verifies `.cad-studio-fullscreen` sets `position: fixed`, `inset: 0`, `width: 100vw`, `height: 100vh`.
- **T1.17**: `test_f4_height_cap_calc_removed_in_fullscreen`: Verifies fullscreen mode eliminates `calc(100vh - 250px)` height cap on canvas container.
- **T1.18**: `test_f4_body_overflow_locked_in_fullscreen`: Verifies document body has `overflow: hidden` while CAD fullscreen is active.
- **T1.19**: `test_f4_normal_layout_restored_on_exit`: Verifies removing fullscreen class cleanly restores default 3-column layout.
- **T1.20**: `test_f4_element_hierarchy_preserved_in_fullscreen`: Verifies toolbar, canvas, sidebar, and action footer remain functional inside fullscreen.

#### F5: Shortcut [F] & Toggle Ergonomics
- **T1.21**: `test_f5_button_click_toggles_fullscreen`: Verifies clicking `#btnToggleCadFullscreen` toggles fullscreen class and updates button text.
- **T1.22**: `test_f5_key_f_toggles_fullscreen`: Verifies pressing key `f` or `F` toggles CAD studio fullscreen.
- **T1.23**: `test_f5_key_f_ignored_in_text_inputs`: Verifies pressing `f` inside `<input>`, `<textarea>`, or `contenteditable` does not toggle fullscreen.
- **T1.24**: `test_f5_modifier_keys_prevent_fullscreen`: Verifies `Ctrl+F`, `Alt+F`, `Meta+F` do not trigger CAD fullscreen.
- **T1.25**: `test_f5_gamemode_active_blocks_cad_shortcut`: Verifies `[F]` keydown is bypassed when manual gamemode is active.

#### F6: Three.js Distortion-Free Resize & State Restore
- **T1.26**: `test_f6_resize_observer_registered_on_container`: Verifies `ResizeObserver` instance observes `#threeContainer`.
- **T1.27**: `test_f6_camera_aspect_ratio_updated_on_resize`: Verifies `resizeThreeViewport()` recalculates `camera.aspect = w / h`.
- **T1.28**: `test_f6_projection_matrix_updated_on_resize`: Verifies `camera.updateProjectionMatrix()` is called upon resize.
- **T1.29**: `test_f6_renderer_set_size_called_with_container_dims`: Verifies `renderer.setSize(w, h, false)` is invoked with new dimensions.
- **T1.30**: `test_f6_prior_sidebar_state_restored_on_fullscreen_exit`: Verifies sidebar collapsed/expanded state prior to fullscreen is remembered and restored on exit.

#### F7: Bot-Cam Offline Fallback Status Card
- **T1.31**: `test_f7_placeholder_card_exists_in_viewer_wrapper`: Verifies `#viewerOfflinePlaceholder` element exists inside `#viewerWrapper`.
- **T1.32**: `test_f7_placeholder_contains_status_text_and_port`: Verifies placeholder card displays informative German text referencing viewer port 3081.
- **T1.33**: `test_f7_iframe_hidden_and_blanked_when_offline`: Verifies `#viewerFrame` is set to `display: none;` and `src="about:blank"` when offline.
- **T1.34**: `test_f7_placeholder_displayed_when_offline`: Verifies `#viewerOfflinePlaceholder` has `display: flex;` when offline.
- **T1.35**: `test_f7_placeholder_hides_when_online`: Verifies placeholder hides and iframe loads stream URL when bot comes online.

#### F8: Bot-Cam Reachability Probe & Retry Action
- **T1.36**: `test_f8_reachability_probe_queries_viewer_port`: Verifies reachability probe executes request against bot viewer endpoint.
- **T1.37**: `test_f8_probe_failure_activates_fallback_ui`: Verifies network error or connection refusal safely switches UI to fallback card.
- **T1.38**: `test_f8_retry_button_click_triggers_probe`: Verifies clicking `#btnRetryViewerConnection` initiates connection probe.
- **T1.39**: `test_f8_retry_button_shows_loading_spinner`: Verifies retry button gains loading state / spinner while probe is in progress.
- **T1.40**: `test_f8_retry_success_restores_stream`: Verifies successful probe resets button state and reloads iframe stream URL.

---

### 6.2 Tier 2: Boundary & Corner Cases (40 Tests)

#### F1 Viewport Boundaries
- **T2.1**: `test_bva_f1_narrow_mobile_dock_320px`: Viewport width at `320px` preserves layout without division by zero.
- **T2.2**: `test_bva_f1_ultrawide_portrait_geometry`: Viewport at `600x2400` adapts canvas without header/footer collision.
- **T2.3**: `test_bva_f1_zero_client_height_guard`: Zero clientHeight returns clamped fallback (100px) preventing WebGL crash.
- **T2.4**: `test_bva_f1_burst_resize_spam`: 50 rapid resize events do not produce memory leaks or listener thrashing.
- **T2.5**: `test_bva_f1_hidden_tab_container_resize`: Container resize while tab is hidden safely pauses camera projection updates.

#### F2 Action Bar Boundaries
- **T2.6**: `test_bva_f2_extended_german_label_wrapping`: Extended button label strings do not overflow action bar container.
- **T2.7**: `test_bva_f2_browser_zoom_200_percent`: Browser zoom at 200% keeps action bar anchored at viewport bottom.
- **T2.8**: `test_bva_f2_disabled_build_queue_click_guard`: Clicks on disabled `#btnStartSceneBuildQueue` are rejected.
- **T2.9**: `test_bva_f2_rapid_double_dispatch_lock`: Rapid double-click on `#btnConfirmBuild` fires only one build dispatch.
- **T2.10**: `test_bva_f2_extreme_object_badge_scaling`: Object count badge scaling from 0 to 9999 does not clip neighboring controls.

#### F3 Sidebar Tabbed Boundaries
- **T2.11**: `test_bva_f3_rapid_tab_switch_spam`: Rapid tab switching stabilizes on final active tab without race condition.
- **T2.12**: `test_bva_f3_empty_scene_tree_rendering`: Empty scene state displays clean "Kein Objekt" notice without error.
- **T2.13**: `test_bva_f3_extreme_scene_tree_overflow`: 500 scene objects scroll within sidebar container without layout explosion.
- **T2.14**: `test_bva_f3_invalid_tab_id_fallback`: Switching to non-existent tab ID safely falls back to default tab.
- **T2.15**: `test_bva_f3_collapse_with_active_input_focus`: Collapsing sidebar when input has focus cleanly blurs without crash.

#### F4 Fullscreen Boundaries
- **T2.16**: `test_bva_f4_native_f11_fullscreen_conflict`: Native browser F11 fullscreen while CAD fullscreen is active does not corrupt layout.
- **T2.17**: `test_bva_f4_rapid_fullscreen_toggle_spam`: 20 rapid fullscreen toggles do not create duplicate DOM classes or detached observers.
- **T2.18**: `test_bva_f4_minimized_window_toggle`: Fullscreen toggle when window is minimized safely handles zero width/height.
- **T2.19**: `test_bva_f4_multi_monitor_dpi_switch`: Dragging across monitors with different devicePixelRatio updates renderer pixel ratio.
- **T2.20**: `test_bva_f4_modal_layer_zindex_priority`: Modal dialogs maintain higher z-index than fullscreen CAD container.

#### F5 Shortcut Ergonomics Boundaries
- **T2.21**: `test_bva_f5_key_repeat_ignored`: Keydown with `event.repeat = true` (holding down F) does not repeatedly toggle.
- **T2.22**: `test_bva_f5_content_editable_ignored`: Keydown inside `contenteditable="true"` element does not toggle fullscreen.
- **T2.23**: `test_bva_f5_ime_composition_ignored`: IME composition keystrokes (`isComposing = true`) do not trigger toggle.
- **T2.24**: `test_bva_f5_missing_dom_elements_graceful`: Missing CAD elements in DOM exits gracefully without `TypeError`.
- **T2.25**: `test_bva_f5_popout_window_focus_isolation`: Pressing [F] in external popout window does not trigger main window CAD fullscreen.

#### F6 Three.js Resize Boundaries
- **T2.26**: `test_bva_f6_fractional_container_dimensions`: Fractional container dimensions (e.g. `1024.7px`) avoid float aspect ratio errors.
- **T2.27**: `test_bva_f6_observer_disconnect_cleanup`: Destroying viewport cleans up `ResizeObserver` listener without memory leaks.
- **T2.28**: `test_bva_f6_webgl_context_loss_recovery`: WebGL context loss event is trapped gracefully without unhandled rejection.
- **T2.29**: `test_bva_f6_frustum_near_far_stability`: Switching from 16:9 to 9:16 aspect ratio does not clip near/far planes.
- **T2.30**: `test_bva_f6_camera_pose_preserved_across_resizes`: Resize cycles preserve camera position and lookAt target without reset.

#### F7 Bot-Cam Fallback Boundaries
- **T2.31**: `test_bva_f7_probe_network_timeout`: Probe response exceeding 3000ms triggers timeout status message.
- **T2.32**: `test_bva_f7_http_500_server_error`: HTTP 500 response from port 3081 displays error card rather than iframe crash.
- **T2.33**: `test_bva_f7_cors_rejection_handling`: Cross-origin fetch blockages are intercepted and routed to offline card.
- **T2.34**: `test_bva_f7_rapid_camera_map_tab_toggling`: Toggling between Camera and 2D-Map tabs does not trigger probe storms.
- **T2.35**: `test_bva_f7_idempotent_placeholder_rendering`: Multiple offline events do not duplicate placeholder cards in DOM.

#### F8 Reachability Probe Boundaries
- **T2.36**: `test_bva_f8_retry_spam_throttling`: Rapid clicks on Retry are debounced to a single active network probe.
- **T2.37**: `test_bva_f8_mid_flight_reconnection`: Server becoming reachable during active retry transitions cleanly.
- **T2.38**: `test_bva_f8_local_dashboard_server_down`: Handles case where local Dashboard server itself is unreachable.
- **T2.39**: `test_bva_f8_custom_viewer_port_configured`: Probe respects dynamically configured custom viewer ports from settings.
- **T2.40**: `test_bva_f8_abort_controller_on_tab_switch`: Switching away from camera tab aborts in-flight reachability probes.

---

### 6.3 Tier 3: Cross-Feature Interactions (8 Tests)

- **T3.1**: `test_interaction_f1_f4_grid_to_fullscreen_transition`: Entering fullscreen expands center column from 52% to 100vw smoothly without jarring layout jumps.
- **T3.2**: `test_interaction_f4_f6_fullscreen_resize_and_restore`: Fullscreen toggle triggers `ResizeObserver`, updates aspect ratio, and exit restores original aspect ratio.
- **T3.3**: `test_interaction_f5_f4_f2_shortcut_fullscreen_action_anchor`: Pressing `[F]` keeps `.build-actions-bar` visible, anchored, and clickable in fullscreen.
- **T3.4**: `test_interaction_f3_f6_sidebar_toggle_canvas_adaptation`: Collapsing `#cadStudioSidebar` immediately triggers Three.js canvas width re-adaptation.
- **T3.5**: `test_interaction_f5_gamemode_offhand_shielding`: In manual Gamemode, `[F]` key triggers Minecraft offhand action and is shielded from CAD fullscreen.
- **T3.6**: `test_interaction_f7_f8_offline_probe_tab_persistence`: Switching between Bot-Cam and 2D-Map tabs preserves offline retry card state and probe logic.
- **T3.7**: `test_interaction_f2_f3_action_bar_with_deep_inspector`: Opening complex Spatial AI inspector does not push pinned action bar off-screen.
- **T3.8**: `test_interaction_f4_f7_fullscreen_cam_probe_decoupling`: Toggling CAD fullscreen does not affect Bot-Cam background probe timers or offline card.

---

### 6.4 Tier 4: Real-World Application Workloads (5 Tests)

- **T4.1**: `test_scenario_architect_fullscreen_workflow`: Multi-step user journey:
  1. User opens mission control dashboard.
  2. Presses `[F]` to enter CAD fullscreen.
  3. Switches sidebar to Spatial AI tab.
  4. Triggers smart path generation between objects.
  5. Clicks `#btnStartSceneBuildQueue` in the pinned action bar.
  6. Presses `[F]` to exit fullscreen.
  7. Verifies 3-column normal layout is restored with identical state.
- **T4.2**: `test_scenario_bot_cam_offline_recovery_lifecycle`: Full recovery lifecycle:
  1. Dashboard boots with port 3081 offline.
  2. Fallback card is displayed with status notice.
  3. User clicks `#btnRetryViewerConnection`.
  4. Spinner displays active reconnection attempt.
  5. Mock port 3081 transitions to online state.
  6. Probe resolves successfully; iframe restores stream.
  7. User toggles CAD fullscreen without stream corruption.
- **T4.3**: `test_scenario_ergonomic_stress_sequence`: High-velocity chaos sequence:
  1. Sidebar collapse -> Tab switch -> Fullscreen enter -> Rapid window resize -> Fullscreen exit via Esc.
  2. Verifies zero aspect ratio distortion, zero NaN matrices, zero listener leaks.
- **T4.4**: `test_scenario_gamemode_to_cad_transitions`: Context transition validation:
  1. User enters manual cockpit gamemode.
  2. Presses `[F]` -> offhand action executes; CAD fullscreen does NOT trigger.
  3. Exits gamemode back to mission control.
  4. Clicks CAD studio; presses `[F]` -> CAD fullscreen enters smoothly.
- **T4.5**: `test_scenario_dual_forwarder_and_perfection_suite`:
  1. Executes `tests/cadWorldStudioPerfectionTest.js` forwarder.
  2. Verifies 100% pass across all 6 CAD perfection phases (Anvil reader, world discovery, Litematica verifier, scene graph, Spatial AI co-pilot, workstation UI).
  3. Verifies `check:syntax` passes with 0 errors.

---

## 7. Execution CLI & Quality Thresholds

### 7.1 Running the Test Suite
The master test runner `tests/runAllTiers.js` provides granular execution:
```bash
# Run all 93 tests across all 4 tiers
node tests/runAllTiers.js

# Run individual tiers
node tests/runAllTiers.js --tier=1
node tests/runAllTiers.js --tier=2
node tests/runAllTiers.js --tier=3
node tests/runAllTiers.js --tier=4

# Run compatibility forwarder
node tests/cadWorldStudioPerfectionTest.js
```

### 7.2 Coverage Thresholds & Quality Gates
| Gate | Metric | Minimum Threshold | Status Requirement |
|---|---|---|---|
| **Tier 1** | Feature Coverage Tests | >= 40 tests | 100% Passing |
| **Tier 2** | Boundary & Edge Cases | >= 40 tests | 100% Passing |
| **Tier 3** | Cross-Feature Interactions | >= 8 tests | 100% Passing |
| **Tier 4** | Real-World Workloads | >= 5 tests | 100% Passing |
| **Total** | Cumulative Suite | **>= 93 tests** | **100% Passing** |
| **Forwarder**| Legacy Perfection Test | 6 of 6 phases | 100% Passing |
| **Syntax** | `npm run check:syntax` | 0 syntax errors | Clean Exit Code 0 |

### 7.3 Exit Code Protocol
- **0**: 100% of executed tests passed with zero assertion failures.
- **1**: Any assertion failure, unhandled rejection, or syntax error occurred.
