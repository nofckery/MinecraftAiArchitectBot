# Project: mc-architect-bot Modernization & Test Decoupling

## Architecture
- **Bot Core & Threat Management**: Mineflayer bot lifecycle, threat detection, state machine combat (`src/bot/botClient.js`, `src/bot/threatManager.js`).
- **AI Model Router & Safe Probe Worker**: LLM endpoint discovery, dual-phase probe worker (Phase 1 metadata/models, Phase 2 chat completion ping), resilient failure detection (`src/ai/modelRouter.js`, `src/ai/safeProbeWorker.js`).
- **Config & Version Management**: Minecraft protocol version discovery, physics handling via clean Mineflayer plugins (`src/config/versionResolver.js`, `src/config/envManager.js`, `src/security/credentialVault.js`).
- **Builder & World Execution**: Voxel canvas, greedy meshing, robust block placement error handling (`src/builder/worldExecutor.js`, `src/builder/greedyMesher.js`, `src/builder/voxelCanvas.js`).
- **Cockpit Web UI & Frontend Submodules**: Express + WebSocket dashboard, decoupled ES submodules (`src/web/dashboardServer.js`, `src/web/public/app.js`, `src/web/public/js/`).
- **Test Infrastructure**: Behavioral contract testing, unit and integration suites under `npm test`, stress and adversarial suites in `test/`.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Robust Combat State Logic | Replace wall-clock `backpedalUntil` timer block in `src/bot/threatManager.js` with non-blocking combat state logic allowing cooldown-ready strikes | M1 | ORIGINAL_REQUEST R2 & R3 |
| 2 | Creeper Neutralization Verification | Ensure `challenger2SurvivalTest.js` Suite 9 passes with creeper defeated (health 0) | M1 | ORIGINAL_REQUEST R2 |
| 3 | Safe Probe Worker Error Handling | Replace blanket `try/catch` around `res.json()` in `src/ai/safeProbeWorker.js` with explicit response text parsing and error discrimination | M2 | ORIGINAL_REQUEST R2 & R3 |
| 4 | Probe Reset Offline Status | Ensure `challenger_m5_router_probe_stress.js` Section 3.1 Phase 1 reports 'offline' on socket reset | M2 | ORIGINAL_REQUEST R2 |
| 5 | Clean Version Handling | Eliminate runtime monkey-patching of `minecraft-data`, `mineflayer`, and `minecraft-protocol`, and eliminate disk writes to `node_modules` in `src/config/versionResolver.js` | M3 | ORIGINAL_REQUEST R3 |
| 6 | Robust WorldExecutor Disconnect Detection | Replace substring matching on `opErr.message` with structured error code and client state checks in `src/builder/worldExecutor.js` | M3 | ORIGINAL_REQUEST R3 |
| 7 | Eliminate Artificial Re-Exports | Remove artificial re-exports from `src/security/credentialVault.js` and `src/builder/voxelCanvas.js`; update importing tests to use canonical sources | M3 | ORIGINAL_REQUEST R1 & R3 |
| 8 | Clean Frontend Facades & Modularity | Remove redundant facades and re-exports from `src/web/public/app.js` and `voxelCanvas.js`, reducing monolithic line counts | M4 | ORIGINAL_REQUEST R3 & R4 |
| 9 | Test Suite Decoupling (`fs.readFileSync`) | Refactor brittle tests scraping source code strings via `fs.readFileSync` in `test/missionControlTest.js`, `test/dashboardCockpitTest.js`, `test/manualGamemodeFrontendTest.js`, etc. to test behavioral contracts, exports, or DOM structure | M4 | ORIGINAL_REQUEST R1 |
| 10 | Modularity Assertions in Adversarial Tests | Replace arbitrary `< 1000` line-count check in `test/challenger_refactor_2_adversarial.js` with structural modularity assertions | M4 | ORIGINAL_REQUEST R1 & R2 |
| 11 | Full Test Suite Reliability & E2E Pass | Verify all 19 standard suites pass with exit code 0 (`npm test`) and all 25 challenger/stress suites pass with exit code 0 | M5 | ORIGINAL_REQUEST R2 |
| 12 | Forensic Integrity Verification | Teamwork forensic auditor runs integrity checks (no dummy facades, no hardcoding, clean implementations) | M5 | ORIGINAL_REQUEST Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | ThreatManager Combat State Logic & Survival Test | `src/bot/threatManager.js`, `test/challenger2SurvivalTest.js` | none | DONE |
| M2 | SafeProbeWorker Error Handling & Router Probe Stress | `src/ai/safeProbeWorker.js`, `test/challenger_m5_router_probe_stress.js` | none | DONE |
| M3 | VersionResolver & Builder Cleanup & Canonical Exports | `src/config/versionResolver.js`, `src/builder/worldExecutor.js`, `src/security/credentialVault.js`, `src/builder/voxelCanvas.js`, `test/coreUtilitiesTest.js` | none | DONE |
| M4 | Frontend Facade Cleanup & Test Decoupling | `src/web/public/app.js`, `test/challenger_refactor_2_adversarial.js`, `test/missionControlTest.js`, `test/dashboardCockpitTest.js`, `test/manualGamemodeFrontendTest.js`, `test/settingsAndOnboardingTest.js`, `test/viewerFullscreenAndPopoutTest.js` | M1, M2, M3 | DONE |
| M5 | Full Suite E2E Regression Pass & Forensic Integrity Audit | Full repository test suites (`npm test`, all `test/challenger*.js`) & `teamwork_auditor` verification | M1, M2, M3, M4 | DONE |
| M6 | Collaborator & GitHub Readiness & SOTA Documentation | Comprehensive README with full setup & operational guide, updated CONTRIBUTING.md, session debris cleanup, ephemeral port binding fix in DashboardServer | M1, M2, M3, M4, M5 | DONE |

## Interface Contracts

### M1: ThreatManager Combat Lifecycle
- `ThreatManager.prototype.combatStep()`:
  - Non-blocking: must not freeze or return early due to wall-clock `backpedalUntil` when attack weapon cooldown is ready (`Date.now() - this.lastAttackTime >= cooldown`).
  - Target state: if mob health drops to <= 0 or mob dies during attack, immediately clear combat target and set state to idle.
  - Verification: `node test/challenger2SurvivalTest.js` completes with exit code 0 and creeper defeated.

### M2: SafeProbeWorker Error Discrimination
- `probePhase1Metadata(endpoint)`:
  - On body stream truncation / socket reset (`ECONNRESET`, `Premature close`, `ERR_STREAM_DESTROYED`): propagate error or return `status: 'offline'`.
  - On valid HTTP 200 with non-JSON text: if text is plain "OK", return `{ models: [], status: 200 }`; if malformed JSON or socket closed, treat as failure (`status: 'offline'`).
  - Verification: `node test/challenger_m5_router_probe_stress.js` reports Phase 1 offline and exits with code 0.

### M3: VersionResolver & Canonical Exports
- `VersionResolver`:
  - Does NOT mutate global packages (`minecraft-data`, `mineflayer`, `minecraft-protocol`) or write to `node_modules`.
  - Provides clean version normalization and feature flags.
- `WorldExecutor`:
  - Disconnect detection checks `bot._client?.ended || opErr.code === 'ERR_DISCONNECTED' || opErr.code === 'ECONNRESET' || opErr.code === 'ERR_STREAM_DESTROYED' || opErr.message?.includes('disconnected')`.
- Canonical Exports:
  - `atomicRenameWithRetry` imported directly from `src/utils/fileUtils.js`.
  - `BLOCK_ALIASES`, `normalizeBlockName` imported directly from `src/builder/greedyMesher.js`.

### M4: Frontend Modularity & Behavioral Contracts
- `app.js`:
  - Removes redundant re-exports while maintaining core event listeners and UI dispatch.
- Decoupled Test Contracts:
  - Tests verify exported functions (`typeof exportName === 'function'`), DOM structure via parser/JSDOM, or HTTP status codes instead of `fs.readFileSync(sourceFile).includes(...)`.
  - `challenger_refactor_2_adversarial.js`: verifies modular submodules exist and export required interfaces without arbitrary `< 1000` line limit assertions.

## Code Layout
- `src/bot/threatManager.js`: Combat and threat management logic.
- `src/ai/safeProbeWorker.js`: Endpoint probe worker and error handling.
- `src/config/versionResolver.js`: Protocol and version resolution without global mutation.
- `src/builder/worldExecutor.js`: World construction and structured error handling.
- `src/security/credentialVault.js`: Clean vault module without artificial re-exports.
- `src/web/public/app.js`: Clean frontend orchestrator.
- `test/`: Standard and challenger test suites refactored for behavioral contracts.
