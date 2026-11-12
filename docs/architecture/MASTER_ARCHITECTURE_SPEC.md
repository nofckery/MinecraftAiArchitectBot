# Autonomous Low-Resource AI Minecraft Architect Bot (v2.0 SOTA)
## Master Architecture Specification

---

### Sektion 1: Systemarchitektur & Datenfluss
- Perception Layer (`src/world/worldScanner.js`, `src/ai/blueprintMemory.js`)
- Cognitive Synthesis & Linter (`src/ai/architectAgent.js`, `src/builder/structuralLinter.js`)
- Session Handoff & Mission Control (`src/bot/sessionHandoff.js`, `src/web/dashboardServer.js`)
- Execution & Journal Layer (`src/builder/worldExecutor.js`, `src/world/undoManager.js`)

---

### Sektion 2: Multi-Provider LLM-Architektur
- Stufe 1: High-Speed Loops (Cerebras, Groq)
- Stufe 2: Deep Context & Code (Codestral, Gemini Flash)
- Stufe 3: Heavy Reasoning (SambaNova DeepSeek, NVIDIA NIM)
- Stufe 4: Zero-Key Notfall-Gateways (Kilo AI, LLM7)

---

### Sektion 3: Prozedurale Architektur-Primitives & VoxelCanvas
- `src/builder/voxelCanvas.js`
- `src/builder/archPrimitives.js`
- `src/builder/stateTransform.js`

---

### Sektion 4: Structural Linter, Stability & Aesthetic Scoring
- Statik & schwebende Blöcke
- Durchgang & Türen
- Ästhetik & Detailgrad (Detail-Ratio)

---

### Sektion 5: 1-Account Session-Handoff & Dual-Control Web-Dashboard
- Automatischer Kick-Erkennungs-Parser (`duplicate_login`)
- 2D-Karten-Rasterung & Wolle-Ersatz
- Live-Telemetrie & Rollback-Journal

---

### Sektion 6: Universal Schematic Importer (`.schem`, `.litematic`, `.nbt`, `.schematic`) & Interactive 3D CAD Refinement

#### 6.1 Universal Schematic Importer (`src/builder/schematicManager.js`)
Der `SchematicManager` bietet standardisierte I/O-Schnittstellen für alle etablierten Minecraft-Bauplanformate:
1. **`.schem` (Sponge v2/v3) & `.schematic` (MCEdit Legacy):**
   - Import via `prismarine-schematic`. Extraktion von Block-Namen und State-Properties.
   - Export via `exportCanvasToSchem(canvas, filename)` in ein Sponge v2 NBT-Archiv (Gzip-komprimiert).
2. **`.nbt` (Structure Block & Create Mod Schematics):**
   - Entpacken via `prismarine-nbt` (`parse` + `simplify`).
   - Einlesen von Paletten (`palette`) und Block-Instanzen (`blocks`).
3. **`.litematic` (Litematica 64-Bit Packed LongArray Format):**
   - Bitweises Entpacken von Regionen mit flexibler Bitbreite (`bitsPerBlock = Math.max(2, Math.ceil(Math.log2(palette.length)))`).
   - Korrekte Behandlung von 64-Bit-Spanning-Grenzen (Bit-Überspannung zwischen aufeinanderfolgenden `BigInt` Wörtern).
   - Unterstützung für multiple Regionen und lokale Offsets.
4. **Server World Reverse-Cloning (`cloneWorldRegionToCanvas`):**
   - Live-Scan von Minecraft-Serverbereichen über den Bot (`bot.blockAt`) in eine neue editierbare `VoxelCanvas`.

#### 6.2 VoxelCanvas & Real-Time CAD Transformations (`src/builder/voxelCanvas.js`)
- **`swapMaterial(fromBlock, toBlock, smartGroupSwap = false)`**:
  - Ersetzt Blöcke unter strikter Beibehaltung aller Block-State-Properties (`facing`, `half`, `shape`, `axis`, `waterlogged`, etc.).
  - `smartGroupSwap`: Konsistentes automatisches Ersetzen ganzer Holz- und Steinfamilien (`_planks`, `_stairs`, `_slab`, `_log`, `_wood`, `_fence`, `_fence_gate`, `_door`, `_trapdoor`, etc.).
- **`applySymmetryOrTransform(mode)`**:
  - Modi: `'mirror_x'`, `'mirror_z'`, `'rotate_90_cw'`, `'shift_y_up'`, `'shift_y_down'`.
  - Vollständige Transformation und Anpassung von Richtungsvektoren über `stateTransform.js`.
- **`createSubRegionProxy(selectionBox)`**:
  - Proxy-Objekt um die `VoxelCanvas`, das Schreiboperationen (`set`, `box`, `clear`) auf den markierten 3D-Bereich beschränkt.

#### 6.3 Region-Scoped AI Refinement & Schematic Remixing (`src/ai/architectAgent.js`)
- **`refineRegionWithAI(instruction, selectionBox)`**:
  - Übermittlung des markierten Bereichs und des bestehenden Modells an den `ARCHITECT_TIER`.
  - Scoped Code-Synthese in `node:vm` gegen den `SubRegionProxy`.
- **`remixImportedSchematic(instruction)`**:
  - Umwandlung importierter externer Schematics in erweiterbare Basismodelle inklusive Linter-Validierung und Self-Healing.

#### 6.4 Web-Dashboard REST- & WebSocket-Integration (`src/web/dashboardServer.js` & `src/web/public/`)
- REST-Routen: `GET /api/schematics`, `POST /api/schematics/upload`, `POST /api/schematics/import-url`, `GET /api/schematics/export/:name`.
- WebSocket-Actions: `swap_material`, `apply_theme`, `transform_canvas`, `manual_voxel_edit`, `region_ai_edit`, `clone_server_region`, `load_saved_schematic`, `request_terrain_xray`.
- Three.js CAD-Werkzeuge: Orbit, 3D-SelectionBox mit visueller Box-Vorschau, Brush, Eraser, Eyedropper, Stückliste (BOM) mit Live-Materialtausch, X-Ray Terrain-Visualisierung, Drag-and-Drop Datei-Upload.
