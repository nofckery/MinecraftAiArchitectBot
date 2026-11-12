import vm from 'node:vm';
import { VoxelCanvas } from '../../builder/voxelCanvas.js';
import { ArchPrimitives } from '../../builder/archPrimitives.js';
import { StructuralLinter } from '../../builder/structuralLinter.js';
import { autoStitchStairs } from '../../builder/stateTransform.js';
import { llmRouter } from '../llmRouter.js';
import { TASK_ROLES } from '../modelKnowledgeBase.js';
import {
  SYSTEM_ARCHITECT_PROMPT,
  createSelfHealingPrompt,
  createDiffPrompt,
  createSpatialSceneContextDigest
} from '../prompts.js';
import { logger } from '../../utils/logger.js';

/**
 * Führt Architektur-Code in einer isolierten Node-VM-Sandbox aus.
 */
export function executeSandboxScript(code, sandbox, timeoutMs = 1500) {
  try {
    vm.createContext(sandbox);
    const script = new vm.Script(`(function() {\n${code}\n})()`);
    script.runInContext(sandbox, { timeout: timeoutMs });
    return { success: true, error: null };
  } catch (err) {
    return { success: false, error: err };
  }
}

/**
 * Synthetisiert einen neuen oder modifizierten Bauplan mit 3-stufiger VM-Sandbox & Linter-Self-Healing.
 */
export async function synthesizeBuildLoop({
  userRequest,
  siteInfo,
  isModification = false,
  lastBuildState = null,
  studioSceneContext = {}
}) {
  let currentCode = '';
  const isMod = isModification && lastBuildState !== null;
  const hasStudioContext = (studioSceneContext.objects && studioSceneContext.objects.length > 0) || Boolean(studioSceneContext.terrain);
  const spatialDigest = hasStudioContext ? `\n\n${createSpatialSceneContextDigest(studioSceneContext)}` : '';

  if (isMod) {
    logger.info('Generiere Bauplan-Modifikation auf Basis des vorherigen Entwurfs...');
    const diffPrompt = `${createDiffPrompt(lastBuildState.code, userRequest, siteInfo)}${spatialDigest}`;
    currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, diffPrompt, { role: TASK_ROLES.REGION_DIFF, isDiff: true });
  } else {
    logger.info('Generiere neuen architektonischen Bauplan...');
    const userPrompt = `
Baue folgenden Auftrag auf dem Grundstück:
Auftrag: "${userRequest}"
Grundstücksdaten:
- Ursprung: (${siteInfo.origin.x}, ${siteInfo.origin.y}, ${siteInfo.origin.z})
- Breite (X): ${siteInfo.width} Blöcke
- Tiefe (Z): ${siteInfo.depth} Blöcke
- Gebäude-Frontrichtung: '${siteInfo.facing}'
- Geländehöhe: ${siteInfo.groundY}${spatialDigest}
`.trim();
    currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, userPrompt, { role: TASK_ROLES.ARCHITECT_CODE, attempt: 1 });
  }

  const maxRetries = 3;
  let finalCanvas = null;
  let finalLint = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    logger.info(`Führe VM-Sandbox-Validierung durch (Versuch ${attempt}/${maxRetries})...`);

    const canvas = new VoxelCanvas(
      siteInfo.width,
      siteInfo.height || 36,
      siteInfo.depth,
      siteInfo.origin,
      siteInfo.facing
    );
    const arch = new ArchPrimitives(canvas);

    const sandbox = {
      canvas,
      arch,
      siteInfo,
      Math,
      console: { log: () => {} }
    };

    const execResult = executeSandboxScript(currentCode, sandbox, 1500);

    if (!execResult.success) {
      logger.warn(`VM-Ausführungsfehler in Iteration ${attempt}: ${execResult.error.message}`);
      if (attempt < maxRetries) {
        const healingPrompt = `
Bei der Ausführung deines Codes trat ein JavaScript-Laufzeitfehler auf:
${execResult.error.message}

Vorheriger Code:
\`\`\`javascript
${currentCode}
\`\`\`
Bitte behebe den Fehler und liefere den vollständigen, lauffähigen Code zurück.
`.trim();
        currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt, {
          role: TASK_ROLES.SELF_HEAL_REASONING,
          isSelfHealing: true,
          attempt: attempt + 1
        });
        continue;
      } else {
        throw new Error(`Architektur-Code konnte nach ${maxRetries} Versuchen nicht ausgeführt werden: ${execResult.error.message}`);
      }
    }

    canvas.finalizeMultiBlocks();
    autoStitchStairs(canvas);

    const lintReport = StructuralLinter.analyze(canvas);

    if (lintReport.passed) {
      logger.build(`Bauwerk erfolgreich synthetisiert und validiert! (Blöcke: ${canvas.blocks.size}, Detail-Anteil: ${Math.round(lintReport.detailRatio * 100)}%)`);
      finalCanvas = canvas;
      finalLint = lintReport;
      break;
    }

    logger.warn(`Linter meldete Fehler in Iteration ${attempt}: ${lintReport.criticalErrors.join(', ')}`);

    if (attempt < maxRetries) {
      const healingPrompt = createSelfHealingPrompt(
        currentCode,
        lintReport.criticalErrors,
        lintReport.warnings,
        lintReport.asciiBlueprint
      );
      currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt, {
        role: TASK_ROLES.SELF_HEAL_REASONING,
        isSelfHealing: true,
        attempt: attempt + 1
      });
    } else {
      throw new Error(`Bauwerk verstößt gegen statische Linter-Regeln:\n${lintReport.criticalErrors.join('\n')}`);
    }
  }

  let diff = null;
  if (isMod && lastBuildState?.canvas) {
    diff = VoxelCanvas.computeDiff(lastBuildState.canvas, finalCanvas);
    logger.info(`Inkrementelles Diff berechnet: ${diff.length} Block-Operationen.`);
  }

  const newBuildState = {
    code: currentCode,
    origin: { ...siteInfo.origin },
    width: siteInfo.width,
    height: siteInfo.height || 36,
    depth: siteInfo.depth,
    facing: siteInfo.facing,
    canvas: finalCanvas
  };

  return {
    canvas: finalCanvas,
    diff,
    lintReport: finalLint,
    code: currentCode,
    siteInfo,
    newBuildState
  };
}

/**
 * Verfeinert einen markierten Teilbereich (Selection Box) mit KI-Diff-Prompts und Sandbox.
 */
export async function refineRegionLoop({ instruction, selectionBox, lastBuildState, fallbackSiteInfo }) {
  let activeState = lastBuildState;
  if (!activeState?.canvas) {
    const siteInfo = fallbackSiteInfo;
    const canvas = new VoxelCanvas(siteInfo.width, siteInfo.height || 36, siteInfo.depth, siteInfo.origin, siteInfo.facing);
    activeState = {
      code: '',
      origin: { ...siteInfo.origin },
      width: siteInfo.width,
      height: siteInfo.height || 36,
      depth: siteInfo.depth,
      facing: siteInfo.facing,
      canvas
    };
  }

  const canvas = activeState.canvas;
  const siteInfo = activeState;
  const proxy = canvas.createSubRegionProxy(selectionBox);
  const arch = new ArchPrimitives(proxy);

  const bounds = canvas.getBounds();
  const bom = {};
  let blocksInsideRegion = 0;
  for (const key of canvas.getAllBlockKeys()) {
    const b = canvas.getByKey(key);
    const { x, y, z } = canvas.parseKey(key);
    bom[b.name] = (bom[b.name] || 0) + 1;
    if (x >= selectionBox.minX && x <= selectionBox.maxX &&
        y >= selectionBox.minY && y <= selectionBox.maxY &&
        z >= selectionBox.minZ && z <= selectionBox.maxZ) {
      blocksInsideRegion++;
    }
  }
  const topMaterials = Object.entries(bom)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([m, c]) => `${m} (${c}x)`)
    .join(', ');

  logger.info(`Generiere KI-Region-Refinement für Bereich (${selectionBox.minX}..${selectionBox.maxX}, ${selectionBox.minY}..${selectionBox.maxY}, ${selectionBox.minZ}..${selectionBox.maxZ})...`);

  const regionPrompt = `
Du bearbeitest einen ARCHITEKTUR-ABSCHNITT innerhalb eines bestehenden Gebäudes.
Benutzer-Auftrag: "${instruction}"
Aktuelle Belegung der VoxelCanvas:
- Bounding-Box: ${bounds.width}x${bounds.height}x${bounds.depth} Blöcke (Gesamt: ${bounds.count} Blöcke)
- Hauptmaterialien des Gebäudes: ${topMaterials || 'keine'}
- Vorhandene Blöcke in der markierten Box: ${blocksInsideRegion}
Markierter Bereich (Selection Box):
- X von ${selectionBox.minX} bis ${selectionBox.maxX}
- Y von ${selectionBox.minY} bis ${selectionBox.maxY}
- Z von ${selectionBox.minZ} bis ${selectionBox.maxZ}

WICHTIG:
- Alle Schreibzugriffe (canvas.set, arch.box, etc.) außerhalb dieser Box werden automatisch blockiert.
- Baue deine Konstruktion exakt in den Koordinaten [${selectionBox.minX}..${selectionBox.maxX}, ${selectionBox.minY}..${selectionBox.maxY}, ${selectionBox.minZ}..${selectionBox.maxZ}].
- Nutze das globale Objekt 'canvas' und 'arch'.
`.trim();

  let currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, regionPrompt, {
    role: TASK_ROLES.REGION_DIFF,
    isDiff: true
  });

  let finalLint = null;
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const sandbox = {
      canvas: proxy,
      arch,
      siteInfo,
      selectionBox,
      Math,
      console: { log: () => {} }
    };

    const execResult = executeSandboxScript(currentCode, sandbox, 1500);

    if (!execResult.success) {
      logger.warn(`VM-Ausführungsfehler bei Region-Refinement: ${execResult.error.message}`);
      if (attempt < maxRetries) {
        const healingPrompt = `Fehler bei Ausführung: ${execResult.error.message}\nVorheriger Code:\n\`\`\`javascript\n${currentCode}\n\`\`\`\nBitte korrigieren.`;
        currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt, {
          role: TASK_ROLES.SELF_HEAL_REASONING,
          isSelfHealing: true,
          attempt: attempt + 1
        });
        continue;
      }
    }

    canvas.finalizeMultiBlocks();
    autoStitchStairs(canvas);
    finalLint = StructuralLinter.analyze(canvas);

    if (finalLint.passed) {
      break;
    }

    logger.warn(`Region-Linter meldete Mängel in Iteration ${attempt}: ${finalLint.criticalErrors.join(', ')}`);
    if (attempt < maxRetries) {
      const healingPrompt = createSelfHealingPrompt(
        currentCode,
        finalLint.criticalErrors,
        finalLint.warnings,
        finalLint.asciiBlueprint
      );
      currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt, {
        role: TASK_ROLES.SELF_HEAL_REASONING,
        isSelfHealing: true,
        attempt: attempt + 1
      });
    }
  }

  const lintReport = finalLint || StructuralLinter.analyze(canvas);
  const updatedCode = `${activeState.code || ''}\n// Region Edit (${selectionBox.minX}..${selectionBox.maxX}):\n${currentCode}`;

  return {
    canvas,
    lintReport,
    code: currentCode,
    updatedCode,
    siteInfo,
    activeState
  };
}

/**
 * Modifiziert oder erweitert ein importiertes Bauwerk via LLM-Remix.
 */
export async function remixSchematicLoop({ instruction, lastBuildState }) {
  if (!lastBuildState?.canvas) {
    throw new Error('Kein Bauwerk in der VoxelCanvas geladen, das remixt werden könnte.');
  }

  const canvas = lastBuildState.canvas;
  const bounds = canvas.getBounds();
  const siteInfo = {
    origin: lastBuildState.origin || { x: 0, y: 0, z: 0 },
    width: bounds.width || 32,
    depth: bounds.depth || 32,
    height: Math.max(36, bounds.height || 36),
    facing: lastBuildState.facing || 'north'
  };

  logger.info(`Remixe importiertes Bauwerk mit Auftrag: "${instruction}"...`);

  const semantics = StructuralLinter.analyzeSemantics(canvas);

  const prompt = `
Du modifizierst oder erweiterst ein bereits in der 'canvas' existierendes Bauwerk!
Auftrag: "${instruction}"

Detaillierte Analyse des geladenen Bauwerks:
${semantics.formattedSummary}

ANWEISUNG:
- Überschreibe nicht das gesamte Gebäude! Ergänze gezielt die geforderten Anbauten (z. B. Fundament, Schornstein, Balkon, Dachdetails, Inneneinrichtung).
- Nutze die bestehenden Materialien und Stile des Bauwerks, um harmonische Übergänge zu schaffen.
- Nutze 'canvas' und 'arch'.
`.trim();

  let currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, prompt, {
    role: TASK_ROLES.REGION_DIFF,
    isDiff: true
  });

  const arch = new ArchPrimitives(canvas);
  let finalLint = null;
  const maxRetries = 3;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const sandbox = {
      canvas,
      arch,
      siteInfo,
      bounds,
      Math,
      console: { log: () => {} }
    };

    const execResult = executeSandboxScript(currentCode, sandbox, 2000);

    if (!execResult.success) {
      logger.warn(`VM-Ausführungsfehler bei Schematic-Remix: ${execResult.error.message}`);
      if (attempt < maxRetries) {
        const healingPrompt = `Fehler bei Ausführung: ${execResult.error.message}\nVorheriger Code:\n\`\`\`javascript\n${currentCode}\n\`\`\`\nBitte korrigieren.`;
        currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt, {
          role: TASK_ROLES.SELF_HEAL_REASONING,
          isSelfHealing: true,
          attempt: attempt + 1
        });
        continue;
      }
    }

    canvas.finalizeMultiBlocks();
    autoStitchStairs(canvas);
    finalLint = StructuralLinter.analyze(canvas);

    if (finalLint.passed) {
      break;
    }

    logger.warn(`Remix-Linter meldete Mängel in Iteration ${attempt}: ${finalLint.criticalErrors.join(', ')}`);
    if (attempt < maxRetries) {
      const healingPrompt = createSelfHealingPrompt(
        currentCode,
        finalLint.criticalErrors,
        finalLint.warnings,
        finalLint.asciiBlueprint
      );
      currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt, {
        role: TASK_ROLES.SELF_HEAL_REASONING,
        isSelfHealing: true,
        attempt: attempt + 1
      });
    }
  }

  const lintReport = finalLint || StructuralLinter.analyze(canvas);
  const updatedCode = `${lastBuildState.code || ''}\n// Remix:\n${currentCode}`;

  return {
    canvas,
    lintReport,
    code: currentCode,
    updatedCode,
    siteInfo
  };
}
