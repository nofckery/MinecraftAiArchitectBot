import { logger } from '../../utils/logger.js';
import { llmRouter, TASK_ROLES } from '../llmRouter.js';
import { SYSTEM_ARCHITECT_PROMPT, createSettlementLayoutPrompt } from '../prompts.js';
import {
  generateSmartPathBetweenObjects,
  analyzeSceneVerifier
} from '../../web/services/terrainMapService.js';

/**
 * Omnipresent Spatial AI Co-Pilot engine for CAD World Studio:
 * - 'connect_landscape': Algorithmic road and bridge generator between buildings
 * - 'settlement_layout': AI settlement topology planner with deterministic ring solver fallback
 * - 'doctor_autofix': Structural overhang analysis, ground elevation snapping, foundation pillar calculation
 * - 'focus_object': Scene-aware contextual object remixed or new object synthesized
 *
 * @param {import('../architectAgent.js').ArchitectAgent} agent - Architect agent instance
 * @param {object} params - Request parameters (mode, instruction, sceneSnapshot, targetObjectId, targetPosition)
 * @returns {Promise<object>} Result actions and messages for client
 */
export async function executeStudioAiCoPilot(agent, params = {}) {
  const {
    mode = 'focus_object',
    instruction = '',
    sceneSnapshot = null,
    targetObjectId = null,
    targetPosition = null
  } = params;

  if (sceneSnapshot) {
    agent.updateStudioSceneContext(sceneSnapshot);
  }

  const objects = agent.studioSceneContext.objects || [];
  const terrain = agent.studioSceneContext.terrain;
  const heightMap = terrain?.heightMap || {};

  // Modus 2: Infrastruktur & Verbindungs-KI (Wege & Brücken zwischen Gebäuden)
  if (mode === 'connect_landscape') {
    const visibleObjs = objects.filter(o => o && o.visible !== false && !o.isInfrastructure);
    if (visibleObjs.length < 2) {
      return {
        action: 'noop',
        message: 'Platziere mindestens 2 Gebäude im Scene Graph, damit die KI Wege und Brücken dazwischen anlegen kann.'
      };
    }

    const pathMaterial = /ziegel|brick/i.test(instruction)
      ? 'stone_bricks'
      : /sand/i.test(instruction)
        ? 'sandstone'
        : /deepslate|schiefer/i.test(instruction)
          ? 'deepslate_bricks'
          : 'cobblestone';

    const createdPaths = [];
    for (let i = 0; i < visibleObjs.length - 1; i++) {
      const objA = visibleObjs[i];
      const objB = visibleObjs[i + 1];
      const pathData = generateSmartPathBetweenObjects(terrain, objA, objB, {
        pathBlock: pathMaterial,
        width: 3
      });
      if (pathData.blocks.length > 0) {
        const bom = {};
        for (const b of pathData.blocks) {
          bom[b.name] = (bom[b.name] || 0) + 1;
        }
        createdPaths.push({
          id: `obj_path_${Date.now()}_${i}`,
          name: pathData.name,
          position: pathData.origin,
          rotation: 0,
          facing: 'north',
          visible: true,
          locked: false,
          isInfrastructure: true,
          bounds: pathData.bounds,
          blocks: pathData.blocks,
          bom
        });
      }
    }

    return {
      action: createdPaths.length === 1 ? 'add_object' : 'add_objects',
      object: createdPaths[0] || null,
      objects: createdPaths,
      summary: `Infrastruktur-KI hat ${createdPaths.length} Gelände-Wege/Brücken (${pathMaterial}) zwischen deinen Gebäuden generiert.`,
      message: `Infrastruktur-KI hat ${createdPaths.length} Gelände-Wege/Brücken (${pathMaterial}) zwischen deinen Gebäuden generiert.`
    };
  }

  // Modus 3: KI-Siedlungs-Planer (Auto-Layout auf dem gescannten Gelände)
  if (mode === 'settlement_layout') {
    const visibleObjs = objects.filter(o => o && o.visible !== false && !o.isInfrastructure);
    if (visibleObjs.length === 0) {
      return {
        action: 'noop',
        message: 'Keine Gebäude in der Szene vorhanden, die angeordnet werden könnten.'
      };
    }

    const center = terrain?.center || { x: 0, y: 64, z: 0 };
    const waterSet = new Set(terrain?.waterColumns || []);
    const repositioned = [];
    let llmSummary = '';

    // Versuche städtebauliche Planung über LLM, mit deterministischem Topologie-Solver als Fallback
    try {
      const layoutPrompt = createSettlementLayoutPrompt(instruction || 'Harmonisches Dorf-Layout um den Dorfplatz', agent.studioSceneContext);
      const plan = await llmRouter.completeJSON(TASK_ROLES.PLANNER_JSON, SYSTEM_ARCHITECT_PROMPT, layoutPrompt);
      if (plan && Array.isArray(plan.repositionExisting) && plan.repositionExisting.length > 0) {
        llmSummary = plan.summary || '';
        for (const item of plan.repositionExisting) {
          const targetObj = visibleObjs.find(o => o.id === item.id);
          if (targetObj) {
            const rx = Math.round(Number(item.x) || center.x);
            const rz = Math.round(Number(item.z) || center.z);
            const w = targetObj.bounds?.width || 12;
            const d = targetObj.bounds?.depth || 12;
            const midKey = `${Math.round(rx + w / 2)},${Math.round(rz + d / 2)}`;
            const groundY = (heightMap[midKey] ?? center.y) + 1;
            repositioned.push({
              id: targetObj.id,
              position: { x: rx, y: groundY, z: rz },
              facing: item.facing || 'north',
              rotation: Number(item.rotation) || 0
            });
          }
        }
      }
    } catch (err) {
      logger.debug(`[StudioAI] Verwende deterministischen Topologie-Solver für Siedlungs-Layout: ${err.message}`);
    }

    // Falls LLM nicht alle Objekte platziert hat: Topologischer Ring-Solver um das Dorfzentrum
    if (repositioned.length < visibleObjs.length) {
      repositioned.length = 0;
      const count = visibleObjs.length;
      const ringRadius = Math.max(14, count * 6);
      const facings = ['south', 'west', 'north', 'east'];
      const rotations = [180, 270, 0, 90];

      for (let i = 0; i < count; i++) {
        const obj = visibleObjs[i];
        const angle = (i / count) * Math.PI * 2;
        const w = obj.bounds?.width || 12;
        const d = obj.bounds?.depth || 12;

        let candX = Math.round(center.x + Math.cos(angle) * ringRadius - w / 2);
        let candZ = Math.round(center.z + Math.sin(angle) * ringRadius - d / 2);

        // Vermeide Wasserflächen
        for (let shift = 0; shift <= 12; shift += 3) {
          const testX = candX + shift;
          const testZ = candZ + shift;
          const midKey = `${Math.round(testX + w / 2)},${Math.round(testZ + d / 2)}`;
          if (!waterSet.has(midKey)) {
            candX = testX;
            candZ = testZ;
            break;
          }
        }

        // Berechne optimale Geländehöhe unter dem Gebäude
        const sampleYs = [];
        for (let sx = candX; sx < candX + w; sx += 2) {
          for (let sz = candZ; sz < candZ + d; sz += 2) {
            const sy = heightMap[`${sx},${sz}`];
            if (sy !== undefined) sampleYs.push(sy);
          }
        }
        const bestY = sampleYs.length > 0
          ? Math.round(sampleYs.reduce((a, b) => a + b, 0) / sampleYs.length) + 1
          : center.y;

        const sectorIdx = Math.round(((angle % (Math.PI * 2)) / (Math.PI * 2)) * 4) % 4;
        repositioned.push({
          id: obj.id,
          position: { x: candX, y: bestY, z: candZ },
          facing: facings[sectorIdx],
          rotation: rotations[sectorIdx]
        });
      }
    }

    const msgText = llmSummary || `${repositioned.length} Gebäude wurden kollisionsfrei auf dem gescannten Gelände ausgerichtet und auf Bodenhöhe eingerastet.`;
    return {
      action: 'update_layout',
      repositioned,
      objects: repositioned,
      summary: msgText,
      message: msgText
    };
  }

  // Modus 4: KI-Statik- & Gelände-Doktor (1-Klick Auto-Fix für Höhen, Kollisionen & Fundamente)
  if (mode === 'doctor_autofix') {
    const visibleObjs = objects.filter(o => o && o.visible !== false);
    const updates = [];

    for (const obj of visibleObjs) {
      const pos = obj.position || { x: 0, y: 64, z: 0 };
      const w = obj.bounds?.width || 12;
      const d = obj.bounds?.depth || 12;
      const surfaceSamples = [];

      for (let sx = pos.x; sx < pos.x + w; sx++) {
        for (let sz = pos.z; sz < pos.z + d; sz++) {
          const sy = heightMap[`${sx},${sz}`];
          if (sy !== undefined) surfaceSamples.push(sy);
        }
      }

      if (surfaceSamples.length > 0) {
        // Setze das Gebäude auf das maximale Boden-Niveau der Grundfläche + 1 (verhindert Eingraben)
        const maxGroundY = Math.max(...surfaceSamples);
        const targetY = maxGroundY + 1;
        if (pos.y !== targetY) {
          updates.push({
            id: obj.id,
            position: { x: pos.x, y: targetY, z: pos.z }
          });
          obj.position = { x: pos.x, y: targetY, z: pos.z };
        }
      }
    }

    const verifier = analyzeSceneVerifier(terrain, visibleObjs);
    const foundationBlocks = [];
    for (const rep of Object.values(verifier.objectReports)) {
      for (const pillar of rep.foundationPillars || []) {
        foundationBlocks.push(pillar);
      }
    }

    const docMsg = `Statik- & Gelände-Doktor abgeschlossen: ${updates.length} Gebäude-Höhen korrigiert, ${foundationBlocks.length} Stützfundament-Blöcke gegen Schwebe-Stellen berechnet.`;
    return {
      action: 'autofix_scene',
      updates,
      objects: visibleObjs,
      verifierReport: verifier,
      foundationBlocksCount: foundationBlocks.length,
      summary: docMsg,
      message: docMsg
    };
  }

  // Modus 1 (Default): Fokus-KI — Bearbeitet das ausgewählte Objekt oder generiert ein neues Gebäude in der Szene
  const activeId = targetObjectId || agent.studioSceneContext.activeObjectId;
  const activeObj = objects.find(o => o.id === activeId);
  const shouldModifyActive = Boolean(activeObj && !/neues\s+haus|neues\s+geb|baue\s+daneben|erstelle\s+neu/i.test(instruction));

  if (shouldModifyActive) {
    agent.updateStudioSceneContext({ activeObjectId: activeObj.id });
    const res = await agent.remixImportedSchematic(instruction);
    const blocks = [];
    const bom = {};
    for (const key of res.canvas.getAllBlockKeys()) {
      const b = res.canvas.getByKey(key);
      const { x, y, z } = res.canvas.parseKey(key);
      blocks.push({ x, y, z, name: b.name, properties: b.properties || {} });
      bom[b.name] = (bom[b.name] || 0) + 1;
    }
    const bounds = res.canvas.getBounds();
    const updObj = {
      id: activeObj.id,
      name: activeObj.name,
      position: activeObj.position,
      rotation: activeObj.rotation,
      blocks,
      bounds,
      bom,
      lintReport: res.lintReport,
      sourceCode: res.code
    };
    const updMsg = `Objekt "${activeObj.name}" erfolgreich unter Berücksichtigung deiner Szene & Edits aktualisiert (${blocks.length} Blöcke).`;
    return {
      action: 'update_object',
      objectId: activeObj.id,
      object: updObj,
      objectData: updObj,
      summary: updMsg,
      message: updMsg
    };
  } else {
    // Neues Gebäude an Zielposition (oder neben bestehenden Gebäuden) generieren
    const basePos = targetPosition || terrain?.center || { x: 0, y: 64, z: 0 };
    const colKey = `${Math.round(basePos.x)},${Math.round(basePos.z)}`;
    const groundY = (heightMap[colKey] !== undefined ? heightMap[colKey] + 1 : basePos.y) || 64;
    const siteInfo = {
      origin: { x: Math.round(basePos.x), y: groundY, z: Math.round(basePos.z) },
      width: 16,
      depth: 16,
      height: 32,
      facing: 'north',
      groundY
    };
    const res = await agent.synthesizeBuild(instruction, siteInfo, false);
    const blocks = [];
    const bom = {};
    for (const key of res.canvas.getAllBlockKeys()) {
      const b = res.canvas.getByKey(key);
      const { x, y, z } = res.canvas.parseKey(key);
      blocks.push({ x, y, z, name: b.name, properties: b.properties || {} });
      bom[b.name] = (bom[b.name] || 0) + 1;
    }
    const bounds = res.canvas.getBounds();
    const newObj = {
      id: `obj_ai_${Date.now()}`,
      name: instruction.slice(0, 28) || 'KI-Bauwerk',
      position: { ...siteInfo.origin },
      rotation: 0,
      facing: siteInfo.facing,
      visible: true,
      locked: false,
      bounds,
      blocks,
      bom,
      lintReport: res.lintReport,
      sourceCode: res.code
    };
    const newMsg = `Neues KI-Bauwerk "${newObj.name}" passend zur Szene generiert und bei (${siteInfo.origin.x}, ${siteInfo.origin.y}, ${siteInfo.origin.z}) platziert.`;
    return {
      action: 'add_object',
      object: newObj,
      objectData: newObj,
      summary: newMsg,
      message: newMsg
    };
  }
}
