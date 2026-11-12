import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  createSyntheticMcaBuffer,
  readChunkFromMcaBuffer,
  scanAnvilWorldSurface
} from '../src/world/anvilRegionReader.js';
import { discoverLocalWorldsAndSchematics } from '../src/utils/minecraftInstanceDetector.js';
import {
  scan3DTerrainRelief,
  analyzeSceneVerifier,
  generateSmartPathBetweenObjects
} from '../src/web/services/terrainMapService.js';
import {
  createSpatialSceneContextDigest,
  createSettlementLayoutPrompt
} from '../src/ai/prompts.js';
import { ArchitectAgent } from '../src/ai/architectAgent.js';
import { llmRouter } from '../src/ai/llmRouter.js';
import {
  resetSceneGraph,
  setTerrainData,
  addSceneObject,
  updateSceneObject,
  selectSceneObject,
  toggleSoloObject,
  snapObjectToGround,
  applyVoxelEditToSceneObject,
  undoSceneAction,
  redoSceneAction,
  getSceneSnapshot,
  serializeSceneProject,
  loadSceneProjectState
} from '../src/web/public/js/sceneGraph.js';

async function runCadWorldStudioPerfectionTests() {
  console.log('=== Starting CAD World Studio & Omnipresent Spatial AI Perfection Tests ===');

  // ---------------------------------------------------------------------------
  // 1. Native Anvil (.mca) Region Reader & Synthetic Region Verification
  // ---------------------------------------------------------------------------
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cad-studio-test-'));
  try {
    const regionDir = path.join(tmpDir, 'saves', 'TestWorld', 'region');
    fs.mkdirSync(regionDir, { recursive: true });

    const mcaBuf = createSyntheticMcaBuffer({
      chunkX: 0,
      chunkZ: 0,
      surfaceY: 68,
      surfaceBlock: 'minecraft:grass_block'
    });
    const mcaFile = path.join(regionDir, 'r.0.0.mca');
    fs.writeFileSync(mcaFile, mcaBuf);

    const parsedChunk = await readChunkFromMcaBuffer(mcaBuf, 0, 0);
    assert.ok(parsedChunk, 'Synthetischer .mca Chunk muss gelesen werden können');

    const worldScan = await scanAnvilWorldSurface(path.join(tmpDir, 'saves', 'TestWorld'), {
      centerX: 8,
      centerZ: 8,
      radius: 6,
      includeFoliage: false
    });

    assert.equal(worldScan.source, 'anvil', 'Scan-Quelle muss anvil sein');
    assert.equal(worldScan.isSimulated, false, 'Echter Anvil-Scan darf nicht als simuliert markiert sein');
    assert.ok(worldScan.blocks.length > 0, 'Oberflächenblöcke müssen aus .mca extrahiert werden');
    assert.ok(worldScan.heightGrid.length > 0, 'Höhenraster muss berechnet werden');
    const centerSample = worldScan.heightGrid.find(c => c.x === 8 && c.z === 8);
    assert.ok(centerSample, 'Zentrum (8,8) muss im Höhenraster enthalten sein');
    assert.equal(centerSample.y, 68, 'Oberflächenhöhe im synthetischen Chunk muss Y=68 sein');
    console.log('✓ 1. Native Anvil (.mca) Region Reader verified');

    // -------------------------------------------------------------------------
    // 2. Local World & External Schematics Discovery
    // -------------------------------------------------------------------------
    const schemDir = path.join(tmpDir, 'schematics');
    fs.mkdirSync(schemDir, { recursive: true });
    fs.writeFileSync(path.join(schemDir, 'medieval_watchtower.schem'), Buffer.from('dummy'));

    const mockInstances = [
      {
        id: 'prism:TestInstance',
        name: 'Prism Launcher: TestInstance',
        rawName: 'TestInstance',
        launcher: 'Prism Launcher',
        instanceDir: tmpDir,
        modsDir: path.join(tmpDir, 'mods')
      }
    ];

    const discovery = discoverLocalWorldsAndSchematics(mockInstances);
    assert.equal(discovery.worlds.length, 1, 'Genau 1 lokale Singleplayer-Welt muss gefunden werden');
    assert.equal(discovery.worlds[0].name, 'TestWorld');
    assert.equal(discovery.schematics.length, 1, 'Genau 1 externes Schematic muss gefunden werden');
    assert.equal(discovery.schematics[0].filename, 'medieval_watchtower.schem');
    console.log('✓ 2. Auto-Discovery for local worlds & external schematics verified');

    // -------------------------------------------------------------------------
    // 3. 3D Terrain Relief Scanner, Litematica Verifier & Smart Path Generator
    // -------------------------------------------------------------------------
    const reliefSim = await scan3DTerrainRelief(null, {
      source: 'bot',
      centerX: 100,
      centerZ: 200,
      radius: 16
    });
    assert.equal(reliefSim.isSimulated, true, 'Offline Bot-Scan muss deterministisches 3D-Relief liefern');
    assert.ok(reliefSim.blocks.length > 100, '3D-Relief muss Oberflächen- und Hangblöcke enthalten');

    const houseA = {
      id: 'obj_house_a',
      name: 'Taverne',
      position: { x: 4, y: 69, z: 4 },
      rotation: 0,
      visible: true,
      blocks: [
        { x: 0, y: 0, z: 0, block: 'cobblestone' },
        { x: 1, y: 0, z: 0, block: 'cobblestone' },
        { x: 0, y: 1, z: 0, block: 'oak_planks' }
      ]
    };

    const houseFloating = {
      id: 'obj_house_float',
      name: 'Schwebender Turm',
      position: { x: 10, y: 73, z: 10 },
      rotation: 0,
      visible: true,
      blocks: [
        { x: 0, y: 0, z: 0, block: 'stone_bricks' }
      ]
    };

    const houseColliding = {
      id: 'obj_house_col',
      name: 'Kollisions-Keller',
      position: { x: 6, y: 68, z: 6 },
      rotation: 0,
      visible: true,
      blocks: [
        { x: 0, y: 0, z: 0, block: 'stone_bricks' }
      ]
    };

    const verifierReport = analyzeSceneVerifier(worldScan, [houseA, houseFloating, houseColliding]);
    assert.ok(verifierReport.summary.solidSupportCount >= 2, 'Taverne auf Y=69 über Boden Y=68 muss Solid Support melden');
    assert.ok(verifierReport.summary.foundationGapCount >= 1, 'Schwebender Turm auf Y=73 muss Fundament-Lücke melden');
    assert.ok(verifierReport.summary.collisionCount >= 1, 'Keller auf Y=68 (im Terrain) muss Kollision melden');
    assert.ok(verifierReport.foundationPillars.length >= 4, 'Fundament-Stützblöcke von Y=72 bis Y=69 müssen berechnet werden');

    const pathResult = generateSmartPathBetweenObjects(worldScan, houseA, houseFloating, { width: 2 });
    assert.ok(pathResult.blocks.length > 0, 'Smart Path Generator muss Wegblöcke zwischen Taverne und Turm erzeugen');
    console.log('✓ 3. Litematica Verifier & Smart Path Generator verified');

    // -------------------------------------------------------------------------
    // 4. Multi-Object Scene Graph, Snap-to-Ground, Undo/Redo & Master BOM
    // -------------------------------------------------------------------------
    resetSceneGraph();
    setTerrainData(worldScan);

    const addedA = addSceneObject(houseA);
    const addedB = addSceneObject(houseFloating);
    assert.equal(getSceneSnapshot().objects.length, 2, '2 Objekte müssen im Scene Graph sein');

    // Snap floating house to ground (terrain Y=68 -> object Y=69)
    const snapped = snapObjectToGround(addedB.id);
    assert.equal(snapped.position.y, 69, 'Snap-to-Ground muss Objekt exakt auf Terrainhöhe + 1 (Y=69) setzen');

    // Undo Snap
    const undone = undoSceneAction();
    assert.equal(undone, true, 'Undo muss erfolgreich sein');
    const afterUndo = getSceneSnapshot().objects.find(o => o.id === addedB.id);
    assert.equal(afterUndo.position.y, 73, 'Nach Undo muss Objekt wieder auf Y=73 sein');

    // Redo Snap
    const redone = redoSceneAction();
    assert.equal(redone, true, 'Redo muss erfolgreich sein');
    const afterRedo = getSceneSnapshot().objects.find(o => o.id === addedB.id);
    assert.equal(afterRedo.position.y, 69, 'Nach Redo muss Objekt wieder auf Y=69 sein');

    // Voxel Edit & UserDelta logging
    selectSceneObject(addedA.id);
    applyVoxelEditToSceneObject(addedA.id, {
      action: 'add',
      x: 0,
      y: 2,
      z: 0,
      block: 'lantern'
    });
    const snapAfterEdit = getSceneSnapshot();
    assert.ok(snapAfterEdit.masterBom.lantern >= 1, 'Master-BOM muss neu gesetzte Laterne enthalten');
    assert.ok(snapAfterEdit.userDeltas.length >= 2, 'UserDeltas müssen für die Spatial KI protokolliert werden');

    // Solo Mode
    toggleSoloObject(addedA.id);
    assert.equal(getSceneSnapshot().soloObjectId, addedA.id, 'Solo-Isolation muss aktiv sein');
    toggleSoloObject(addedA.id);
    assert.equal(getSceneSnapshot().soloObjectId, null, 'Solo-Isolation muss wieder deaktiviert sein');

    // Project Serialization
    const savedProj = serializeSceneProject('TestDorf');
    assert.equal(savedProj.projectName, 'TestDorf');
    assert.equal(savedProj.objects.length, 2);
    resetSceneGraph();
    assert.equal(getSceneSnapshot().objects.length, 0);
    loadSceneProjectState(savedProj);
    assert.equal(getSceneSnapshot().objects.length, 2, 'Projekt-Import muss alle Objekte wiederherstellen');
    console.log('✓ 4. Multi-Object Scene Graph, Snap-to-Ground, Undo/Redo & Project Save/Load verified');

    // -------------------------------------------------------------------------
    // 5. Omnipresent Spatial AI (Scene Digest & All 4 Studio Co-Pilot Modes)
    // -------------------------------------------------------------------------
    const sceneCtx = {
      terrain: worldScan,
      objects: getSceneSnapshot().objects,
      activeObjectId: addedA.id,
      verifierReport,
      userDeltas: getSceneSnapshot().userDeltas
    };
    const digest = createSpatialSceneContextDigest(sceneCtx);
    assert.ok(digest.includes('OMNIPRESENT SPATIAL CAD STUDIO CONTEXT'), 'Digest muss Header enthalten');
    assert.ok(digest.includes('Taverne'), 'Digest muss platzierte Gebäude auflisten');
    assert.ok(digest.includes('LETZTE MANUELLE USER-ÄNDERUNGEN'), 'Digest muss manuelle User-Edits enthalten');

    const layoutPrompt = createSettlementLayoutPrompt('Ordne die Häuser im Halbkreis an', sceneCtx);
    assert.ok(layoutPrompt.includes('locations'), 'Settlement-Layout-Prompt muss JSON-Schema anfordern');

    // Test ArchitectAgent Studio Co-Pilot modes (offline deterministic fallback / doctor / connect)
    const logs = [];
    const agent = new ArchitectAgent((sender, msg) => logs.push({ sender, msg }));
    agent.setStudioTerrainContext(worldScan);
    agent.updateStudioSceneContext({
      objects: [houseA, houseFloating],
      activeObjectId: houseA.id,
      verifierReport,
      userDeltas: ['User moved Schwebender Turm to Y=73']
    });

    // Mode 1: connect_landscape
    const connectRes = await agent.executeStudioAiCoPilot({
      mode: 'connect_landscape',
      instruction: 'Verbinde Taverne und Turm mit einem Weg'
    });
    assert.equal(connectRes.action, 'add_object');
    assert.ok(connectRes.object.blocks.length > 0, 'connect_landscape muss Weg-Szene-Objekt erzeugen');

    // Mode 2: doctor_autofix
    const doctorRes = await agent.executeStudioAiCoPilot({
      mode: 'doctor_autofix',
      instruction: 'Korrigiere alle Höhen und Fundamente'
    });
    assert.equal(doctorRes.action, 'autofix_scene');
    const fixedTower = doctorRes.objects.find(o => o.id === houseFloating.id);
    assert.equal(fixedTower.position.y, 69, 'Spatial Doctor muss schwebenden Turm auf Terrainhöhe Y=69 snappen');

    // Mode 3: settlement_layout (deterministic terrain-aware placement when no LLM API key is active)
    const origCompleteJSON = llmRouter.completeJSON;
    llmRouter.completeJSON = async () => { throw new Error('Simulated offline for fast deterministic solver test'); };
    try {
      const layoutRes = await agent.executeStudioAiCoPilot({
        mode: 'settlement_layout',
        instruction: 'Optimiere das Dorf-Layout'
      });
      assert.equal(layoutRes.action, 'update_layout');
      assert.equal(layoutRes.objects.length, 2, 'Settlement-Layout muss Positionen für beide Gebäude liefern');
    } finally {
      llmRouter.completeJSON = origCompleteJSON;
    }
    console.log('✓ 5. Omnipresent Spatial AI Co-Pilot & Scene Context Digest verified');

    // -------------------------------------------------------------------------
    // 6. Frontend DOM & Wiring Verification
    // -------------------------------------------------------------------------
    const indexHtml = fs.readFileSync(path.resolve('src/web/public/index.html'), 'utf8');
    const requiredIds = [
      'cadStudioColumn',
      'btnToggleCadFullscreen',
      'cadWorldScanBar',
      'selWorldScanSource',
      'btnScanWorldIntoCad',
      'toolGizmoMove',
      'toolGizmoRotate',
      'toolPlaceOnTerrain',
      'toolMeasure',
      'btnSceneUndo',
      'btnSceneRedo',
      'sliderSunTime',
      'sliderGhostOpacity',
      'btnToggleVerifier',
      'cadStudioSidebar',
      'sceneTreeList',
      'sceneObjectInspector',
      'btnSnapToGround',
      'studioAiCopilotPanel',
      'selStudioAiMode',
      'btnRunStudioAi',
      'btnStartSceneBuildQueue',
      'btnExportCompositeScene'
    ];
    for (const id of requiredIds) {
      assert.ok(indexHtml.includes(`id="${id}"`), `index.html muss Element #${id} enthalten`);
    }
    console.log('✓ 6. CAD World Studio HTML Workstation UI verified');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('=== ALL CAD WORLD STUDIO & SPATIAL AI TESTS PASSED ===');
}

runCadWorldStudioPerfectionTests().catch((err) => {
  console.error('CAD World Studio Test Failed:', err);
  process.exit(1);
});
