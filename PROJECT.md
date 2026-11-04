# Project: Autonomous Low-Resource AI Minecraft Architect Bot (v2.0 SOTA)

## Architecture
Das Projekt ist eine modulare Node.js-Anwendung (ES Modules, Node >= 20), die natürliche Sprachbefehle via Multi-Provider LLM-Kaskade in 3D-Minecraft-Bauwerke übersetzt und via Mineflayer/RCON ausführt oder im Three.js 3D CAD Web-Dashboard darstellt.

### Subsysteme & Datenfluss
1. **Perception**: `src/world/worldScanner.js` (Wolle-Marker-Erkennung, Geländehöhenscan, Nachbarschaftspalette).
2. **Cognitive Synthesis & AI**: `src/ai/llmRouter.js` (4-Stufen LLM-Kaskade), `src/ai/architectAgent.js` (VM-Sandbox, Self-Healing), `src/ai/prompts.js`, `src/ai/blueprintMemory.js`.
3. **Builder SDK & CAD Engine**: `src/builder/voxelCanvas.js` (3D-Grid, Fuzzy Matching, Greedy Meshing), `src/builder/archPrimitives.js` (12 Module), `src/builder/stateTransform.js` (Rotationsmathematik).
4. **Structural Linter**: `src/builder/structuralLinter.js` (BFS Flood-Fill Statik, Tür-Clearance, Anti-Cube Ästhetik).
5. **Schematic Engine**: `src/builder/schematicManager.js` (Sponge .schem, Litematica .litematic, Vanilla .nbt, MCEdit .schematic).
6. **Execution & Rollback**: `src/builder/worldExecutor.js` (2-Phasen Topologie), `src/world/undoManager.js` (Undo-Journal).
7. **Bot & Dual Control**: `src/bot/botClient.js`, `src/bot/sessionHandoff.js` (1-Account Handoff), `src/bot/chatController.js`, `src/bot/inventoryManager.js`.
8. **Mission Control Web-UI**: `src/web/dashboardServer.js`, `src/web/public/` (Three.js 3D CAD, 2D Relief Map, WebSocket Telemetrie).

---

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Soll-Ist-Analyse Dokument | Strukturierter Vergleich zwischen Master Architecture Spec v2.0 und Ist-Zustand des Codes | M1 | Survey E1, E2, R1 |
| 2 | Mocks & Stubs Bestandsaufnahme | Exakte Liste aller 31 Mocks, Platzhalter, ungenutzter Stubs und Offline-Simulationen mit Dateipfaden & Zeilen | M1 | Survey E2, R1 |
| 3 | Erweiterungs- & Verbesserungsempfehlungen | Detaillierte Empfehlungen geordnet nach Subsystemen (Pathfinding, AI, Survival, CAD, Security) | M1 | Survey E1, E2, R2 |
| 4 | Publikationsreife README.md | Vollständige Dokumentation: Projektbeschreibung, Features, Web CAD UI, 169 Tests, Quickstart, Konfigurationstabelle, RCON, Troubleshooting | M2 | Survey E1, E3, R3 |
| 5 | Open Source Lizenz & Contributing | MIT-Lizenzdatei `LICENSE` und Beitragsrichtlinien `CONTRIBUTING.md` | M2 | Survey E1, E3, R3 |
| 6 | Package.json Metadaten | Ergänzung von description, keywords, author, license, repository, bugs in `package.json` | M2 | Survey E3, R3 |
| 7 | Release-taugliche .gitignore | Zuverlässiger Ausschluss von `node_modules/`, `.env.*`, `.agents/`, `data/bot.log`, `data/schematics/*`, IDE- & OS-Dateien | M2 | Survey E1, E3, R4 |
| 8 | Repository Hygiene & Cleanup | Bereinigung temporärer Testschematics, Log-Bereinigung, Erstellung von `data/schematics/.gitkeep` | M2 | Survey E3, R4 |
| 9 | Git-Initialisierung & Secret Scan | Bestätigung der Abwesenheit von Secrets/Keys und Initialisierung des lokalen Git-Repositories | M2 | Survey E3, R4 |
| 10 | Qualitätssicherung & Forensic Integrity Audit | 169/169 Tests Verifikation, Dokumentations-Links-Prüfung, Challenger-Tests, Forensic Integrity Audit | M3 | Survey E1, E2, E3, Gate |

---

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Audit- & Analyse-Berichte | Erstellung von `SOLL_IST_ANALYSE.md` und `VERBESSERUNGSPOTENZIALE.md` (inkl. 31-Punkte Mock-Inventar) | Phase 0 Survey | **DONE** (`SOLL_IST_ANALYSE.md`, `VERBESSERUNGSPOTENZIALE.md`) |
| M2 | GitHub-Dokumentation & Release-Hygiene | `README.md`, `LICENSE`, `CONTRIBUTING.md`, `package.json`, `.gitignore`, Cleanup, `.gitkeep`, Git Init & Remote | M1 | **DONE** (Vollständiges Release-Paket & Remote `nofckery/MinecraftAiArchitectBot`) |
| M3 | E2E Review & Forensic Gate | Ausführung aller Tests, Reviewer-Prüfung, Challenger-Verifikation, Forensic Integrity Audit | M1, M2 | **DONE** (Gate Iteration: PASS, Reviewer APPROVE, Challenger APPROVE, Auditor CLEAN) |
| M4 | 31-Punkte Behebungs- & Härtungscampagne | Lückenlose Behebung aller 31 Schwachstellen, Mocks & Stubs, Structure-NBT-Export, Linter-Self-Healing, Survival-Schutz, 187 Assertions | M1-M3 | **DONE (100% BEHOBEN, 187/187 PASS)** |

---

## Interface Contracts
### Documentation ↔ Repository
- `README.md`: Verweist auf `SOLL_IST_ANALYSE.md`, `VERBESSERUNGSPOTENZIALE.md`, `.env.example`, `package.json` und `LICENSE`.
- `SOLL_IST_ANALYSE.md`: Exakte Referenzen auf Quelldateien (`src/...`), Testergebnisse (`test/dryRunTest.js`, `test/missionControlTest.js`, `test/improvementsTest.js`), `MASTER_ARCHITECTURE_SPEC.md`.
- `VERBESSERUNGSPOTENZIALE.md`: Tabellarisches Mock- & Stubs-Inventar mit Datei, Zeile, Mangel und Bestätigung der 100%igen Behebung.
- `.gitignore`: Schützt `.env`, `.env.*`, `.agents/`, `node_modules/`, `data/bot.log`, temporäre Schematics, während `.env.example`, `data/schematics/.gitkeep`, `data/style_memory.json` getrackt bleiben.

---

## Code Layout
- Root: `README.md`, `LICENSE`, `CONTRIBUTING.md`, `package.json`, `package-lock.json`, `.gitignore`, `.env.example`, `index.js`, `SOLL_IST_ANALYSE.md`, `VERBESSERUNGSPOTENZIALE.md`, `MASTER_ARCHITECTURE_SPEC.md`
- `src/`: Quellcode mit gehärtetem Collision-Avoidance, Material-Vorabprüfung, Survival-Schutz, Linter-Self-Healing und NBT-Export
- `test/`: Test-Suiten `dryRunTest.js` (89 Tests), `missionControlTest.js` (80 Tests) und `improvementsTest.js` (18 Tests)
- `data/`: `style_memory.json`, `schematics/.gitkeep` (Logs und temporäre Testdateien werden ignoriert/bereinigt)
