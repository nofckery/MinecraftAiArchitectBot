# Dokumentationsübersicht & Spezifikationen

Dieser Ordner enthält vertiefende Architektur-Spezifikationen, Test-Konzepte und historische Planungsunterlagen des **Autonomous AI Minecraft Architect Bot**.

---

## 📂 Struktur & Verzeichnisse

### 1. [architecture/](./architecture/)
* **[MASTER_ARCHITECTURE_SPEC.md](./architecture/MASTER_ARCHITECTURE_SPEC.md)**: Vollständige 6-Schichten-Architektur des Bots (Perception, Cognitive, Geometry, Execution, Session Handoff & Dashboard).
* **[SURVIVAL_DOKUMENTATION.md](./architecture/SURVIVAL_DOKUMENTATION.md)**: Detail-Dokumentation für Survival-Funktionen (Bed-Tracking, ThreatManager, Kisten-Logistik, Gerüstbau).
* **[SURVIVAL_EXPEDITION_SPEC.md](./architecture/SURVIVAL_EXPEDITION_SPEC.md)**: Spezifikation für autonome Höhlen-Expeditionen, Erzabbau (Vein Mining) und automatische Heimkehr/Einlagerung.

### 2. [testing/](./testing/)
* **[TEST_INFRA.md](./testing/TEST_INFRA.md)**: 4-Tier Test-Infrastruktur & Qualitätssicherungs-Architektur (Features, Boundary Cases, Cross-Feature Interactions, Real-World Scenarios).
* **[TEST_READY.md](./testing/TEST_READY.md)**: Checkliste und Verifikationsprotokoll für Releases und Regressionstests.

### 3. [specs/](./specs/)
* **[PROJECT.md](./specs/PROJECT.md)**: Spezifikation und Meilensteine des Mission Control CAD-Studio Overhauls (Fullscreen, 3-Spalten-Layout, Viewport-Anpassung).

### 4. [archive/](./archive/)
*Historische Planungs- und Analyse-Artefakte früherer Entwicklungsphasen:*
* **[IMPLEMENTIERUNGSPLAN_MODELLVERBINDUNGEN.md](./archive/IMPLEMENTIERUNGSPLAN_MODELLVERBINDUNGEN.md)**: Ursprünglicher Implementierungsplan für Multi-Provider-LLM-Kaskaden und Device Flow.
* **[SOLL_IST_ANALYSE.md](./archive/SOLL_IST_ANALYSE.md)**: Erste Bestandsaufnahme vor Einführung von v2.0 SOTA.
* **[VERBESSERUNGSPOTENZIALE.md](./archive/VERBESSERUNGSPOTENZIALE.md)**: Backlog-Sammlung initialer Optimierungspotenziale.
