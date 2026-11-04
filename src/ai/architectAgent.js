import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { VoxelCanvas } from '../builder/voxelCanvas.js';
import { ArchPrimitives } from '../builder/archPrimitives.js';
import { StructuralLinter } from '../builder/structuralLinter.js';
import { autoStitchStairs } from '../builder/stateTransform.js';
import { llmRouter } from './llmRouter.js';
import { blueprintMemory } from './blueprintMemory.js';
import {
  SYSTEM_ARCHITECT_PROMPT,
  createPitchPrompt,
  createSelfHealingPrompt,
  createDiffPrompt
} from './prompts.js';
import { logger } from '../utils/logger.js';
import { worldScanner } from '../world/worldScanner.js';

export class ArchitectAgent extends EventEmitter {
  constructor(bot = null) {
    super();
    this.bot = bot;
    this.lastBuildState = null;
    this.pendingProposal = null;
    this.instantMode = false;
    this.customSiteInfo = null;
  }

  setBot(bot) {
    this.bot = bot;
  }

  setInstantMode(enabled) {
    this.instantMode = !!enabled;
  }

  setCustomBounds(bounds) {
    const minX = Math.min(bounds.minX, bounds.maxX);
    const maxX = Math.max(bounds.minX, bounds.maxX);
    const minZ = Math.min(bounds.minZ, bounds.maxZ);
    const maxZ = Math.max(bounds.minZ, bounds.maxZ);
    const width = maxX - minX + 1;
    const depth = maxZ - minZ + 1;
    const groundY = bounds.baseY ?? (this.bot?.entity?.position?.y ? Math.floor(this.bot.entity.position.y) : 64);
    const facing = bounds.facing || 'north';

    // 2.3 Reale Höhendaten und Nachbarschaftspalette scannen, falls Bot online ist
    const terrainMap = {};
    const neighborhoodCounts = {};

    if (this.bot && typeof this.bot.blockAt === 'function') {
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          let foundY = groundY;
          for (let y = groundY + 5; y >= groundY - 12; y--) {
            const b = this.bot.blockAt(new Vec3(x, y, z));
            if (b && !b.name.includes('air') && !b.name.includes('leaves') && !b.name.includes('log')) {
              foundY = y;
              break;
            }
          }
          terrainMap[`${x},${z}`] = foundY - groundY;
        }
      }

      // Umgebungs-Blöcke erfassen
      for (let dx = -4; dx <= width + 4; dx += 2) {
        for (let dz = -4; dz <= depth + 4; dz += 2) {
          for (let dy = -2; dy <= 6; dy += 2) {
            const b = this.bot.blockAt(new Vec3(minX + dx, groundY + dy, minZ + dz));
            if (b && !b.name.includes('air') && !b.name.includes('grass_block') && !b.name.includes('dirt')) {
              neighborhoodCounts[b.name] = (neighborhoodCounts[b.name] || 0) + 1;
            }
          }
        }
      }
    }

    const neighborhoodPalette = Object.entries(neighborhoodCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name]) => name);

    this.customSiteInfo = {
      origin: { x: minX, y: groundY, z: minZ },
      width,
      depth,
      height: 36,
      facing,
      groundY,
      terrainMap,
      neighborhoodPalette,
      bounds: { minX, minZ, maxX, maxZ, baseY: groundY, facing }
    };
    logger.info(`Benutzerdefinierte Baufläche festgelegt: ${width}x${depth} Blöcke bei (${minX}, ${groundY}, ${minZ}), Ausrichtung: ${facing}`);
  }

  getEffectiveSiteInfo(username = null) {
    if (this.customSiteInfo) {
      return this.customSiteInfo;
    }
    return worldScanner.scanBuildSite(this.bot, username);
  }

  async createPitch(userRequest, siteInfo) {
    const recentStyles = blueprintMemory.getRecentStyles();
    const prompt = createPitchPrompt(userRequest, siteInfo, recentStyles);

    try {
      const pitch = await llmRouter.completeJSON('FAST_TIER', SYSTEM_ARCHITECT_PROMPT, prompt);
      this.pendingProposal = {
        userRequest,
        siteInfo,
        pitch
      };
      return pitch;
    } catch (err) {
      logger.warn(`Konnte keinen interaktiven Pitch erstellen (${err.message}). Schalte auf Direktbau um.`);
      return null;
    }
  }

  async synthesizeBuild(userRequest, siteInfo, isModification = false) {
    let currentCode = '';
    const isMod = isModification && this.lastBuildState !== null;

    if (isMod) {
      logger.info('Generiere Bauplan-Modifikation auf Basis des vorherigen Entwurfs...');
      const diffPrompt = createDiffPrompt(this.lastBuildState.code, userRequest, siteInfo);
      currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, diffPrompt);
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
- Geländehöhe: ${siteInfo.groundY}
`.trim();
      currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, userPrompt);
    }

    // 3-Stufiger Sandbox- & Self-Healing-Loop
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

      // Isolierte VM-Sandbox mit 1.500 ms Timeout-Schutz
      const sandbox = {
        canvas,
        arch,
        siteInfo,
        Math,
        console: { log: () => {} }
      };

      let executionError = null;
      try {
        vm.createContext(sandbox);
        const script = new vm.Script(`(function() {\n${currentCode}\n})()`);
        script.runInContext(sandbox, { timeout: 1500 });
      } catch (err) {
        executionError = err;
      }

      if (executionError) {
        logger.warn(`VM-Ausführungsfehler in Iteration ${attempt}: ${executionError.message}`);
        if (attempt < maxRetries) {
          const healingPrompt = `
Bei der Ausführung deines Codes trat ein JavaScript-Laufzeitfehler auf:
${executionError.message}

Vorheriger Code:
\`\`\`javascript
${currentCode}
\`\`\`
Bitte behebe den Fehler und liefere den vollständigen, lauffähigen Code zurück.
`.trim();
          currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt);
          continue;
        } else {
          throw new Error(`Architektur-Code konnte nach ${maxRetries} Versuchen nicht ausgeführt werden: ${executionError.message}`);
        }
      }

      // Multi-Blocks vervollständigen und Treppen verbinden
      canvas.finalizeMultiBlocks();
      autoStitchStairs(canvas);

      // Structural Linter Analyse
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
        currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt);
      } else {
        // Letzter Versuch fehlgeschlagen
        throw new Error(`Bauwerk verstößt gegen statische Linter-Regeln:\n${lintReport.criticalErrors.join('\n')}`);
      }
    }

    // Diff berechnen, falls Umbau vorliegt
    let diff = null;
    if (isMod && this.lastBuildState?.canvas) {
      diff = VoxelCanvas.computeDiff(this.lastBuildState.canvas, finalCanvas);
      logger.info(`Inkrementelles Diff berechnet: ${diff.length} Block-Operationen.`);
    }

    // State für spätere Modifikationen aktualisieren
    this.lastBuildState = {
      code: currentCode,
      origin: { ...siteInfo.origin },
      width: siteInfo.width,
      height: siteInfo.height || 36,
      depth: siteInfo.depth,
      facing: siteInfo.facing,
      canvas: finalCanvas
    };

    const result = {
      canvas: finalCanvas,
      diff,
      lintReport: finalLint,
      code: currentCode,
      siteInfo
    };

    try {
      this.emit('preview', {
        canvas: finalCanvas,
        diff,
        lintReport: finalLint,
        siteInfo,
        userRequest
      });
    } catch (err) {
      logger.warn(`Fehler beim Emitten des Preview-Events: ${err.message}`);
    }

    return result;
  }

  async refineRegionWithAI(instruction, selectionBox) {
    if (!this.lastBuildState?.canvas) {
      const siteInfo = this.getEffectiveSiteInfo();
      const canvas = new VoxelCanvas(siteInfo.width, siteInfo.height || 36, siteInfo.depth, siteInfo.origin, siteInfo.facing);
      this.lastBuildState = {
        code: '',
        origin: { ...siteInfo.origin },
        width: siteInfo.width,
        height: siteInfo.height || 36,
        depth: siteInfo.depth,
        facing: siteInfo.facing,
        canvas
      };
    }

    const canvas = this.lastBuildState.canvas;
    const siteInfo = this.lastBuildState;
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

    let currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, regionPrompt);

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

      let executionError = null;
      try {
        vm.createContext(sandbox);
        const script = new vm.Script(`(function() {\n${currentCode}\n})()`);
        script.runInContext(sandbox, { timeout: 1500 });
      } catch (err) {
        executionError = err;
      }

      if (executionError) {
        logger.warn(`VM-Ausführungsfehler bei Region-Refinement: ${executionError.message}`);
        if (attempt < maxRetries) {
          const healingPrompt = `Fehler bei Ausführung: ${executionError.message}\nVorheriger Code:\n\`\`\`javascript\n${currentCode}\n\`\`\`\nBitte korrigieren.`;
          currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt);
          continue;
        }
      }

      canvas.finalizeMultiBlocks();
      autoStitchStairs(canvas);
      finalLint = StructuralLinter.analyze(canvas);

      if (finalLint.passed) {
        break;
      }

      // 3.3 Self-Healing bei fehlerhaftem Linter in Region-Edits
      logger.warn(`Region-Linter meldete Mängel in Iteration ${attempt}: ${finalLint.criticalErrors.join(', ')}`);
      if (attempt < maxRetries) {
        const healingPrompt = createSelfHealingPrompt(
          currentCode,
          finalLint.criticalErrors,
          finalLint.warnings,
          finalLint.asciiBlueprint
        );
        currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt);
      }
    }

    const lintReport = finalLint || StructuralLinter.analyze(canvas);

    this.lastBuildState.code = `${this.lastBuildState.code || ''}\n// Region Edit (${selectionBox.minX}..${selectionBox.maxX}):\n${currentCode}`;

    const previewData = {
      canvas,
      lintReport,
      siteInfo,
      userRequest: `[Region Edit] ${instruction}`
    };

    try {
      this.emit('preview', previewData);
    } catch (err) {
      logger.warn(`Fehler beim Emitten des Preview-Events: ${err.message}`);
    }

    return {
      canvas,
      lintReport,
      code: currentCode
    };
  }

  async remixImportedSchematic(instruction) {
    if (!this.lastBuildState?.canvas) {
      throw new Error('Kein Bauwerk in der VoxelCanvas geladen, das remixt werden könnte.');
    }

    const canvas = this.lastBuildState.canvas;
    const bounds = canvas.getBounds();
    const siteInfo = {
      origin: this.lastBuildState.origin || { x: 0, y: 0, z: 0 },
      width: bounds.width || 32,
      depth: bounds.depth || 32,
      height: Math.max(36, bounds.height || 36),
      facing: this.lastBuildState.facing || 'north'
    };

    logger.info(`Remixe importiertes Bauwerk mit Auftrag: "${instruction}"...`);

    const prompt = `
Du modifizierst oder erweiterst ein bereits in der 'canvas' existierendes Bauwerk!
Auftrag: "${instruction}"
Aktuelle Bounding-Box des Bauwerks:
- X: 0 bis ${bounds.width - 1} (Breite: ${bounds.width})
- Y: 0 bis ${bounds.height - 1} (Höhe: ${bounds.height})
- Z: 0 bis ${bounds.depth - 1} (Tiefe: ${bounds.depth})
- Bereits vorhandene Blöcke: ${bounds.count}

ANWEISUNG:
- Überschreibe nicht das gesamte Gebäude! Ergänze gezielt die geforderten Anbauten (z. B. Fundament, Schornstein, Balkon, Dachdetails, Inneneinrichtung).
- Nutze 'canvas' und 'arch'.
`.trim();

    let currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, prompt);

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

      let executionError = null;
      try {
        vm.createContext(sandbox);
        const script = new vm.Script(`(function() {\n${currentCode}\n})()`);
        script.runInContext(sandbox, { timeout: 2000 });
      } catch (err) {
        executionError = err;
      }

      if (executionError) {
        logger.warn(`VM-Ausführungsfehler bei Schematic-Remix: ${executionError.message}`);
        if (attempt < maxRetries) {
          const healingPrompt = `Fehler bei Ausführung: ${executionError.message}\nVorheriger Code:\n\`\`\`javascript\n${currentCode}\n\`\`\`\nBitte korrigieren.`;
          currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt);
          continue;
        }
      }

      canvas.finalizeMultiBlocks();
      autoStitchStairs(canvas);
      finalLint = StructuralLinter.analyze(canvas);

      if (finalLint.passed) {
        break;
      }

      // 3.3 Self-Healing bei Linter-Fehlern in Remix
      logger.warn(`Remix-Linter meldete Mängel in Iteration ${attempt}: ${finalLint.criticalErrors.join(', ')}`);
      if (attempt < maxRetries) {
        const healingPrompt = createSelfHealingPrompt(
          currentCode,
          finalLint.criticalErrors,
          finalLint.warnings,
          finalLint.asciiBlueprint
        );
        currentCode = await llmRouter.generateCode(SYSTEM_ARCHITECT_PROMPT, healingPrompt);
      }
    }

    const lintReport = finalLint || StructuralLinter.analyze(canvas);

    this.lastBuildState.code = `${this.lastBuildState.code || ''}\n// Remix:\n${currentCode}`;

    const previewData = {
      canvas,
      lintReport,
      siteInfo,
      userRequest: `[Remix] ${instruction}`
    };

    try {
      this.emit('preview', previewData);
    } catch (err) {
      logger.warn(`Fehler beim Emitten des Preview-Events: ${err.message}`);
    }

    return {
      canvas,
      lintReport,
      code: currentCode
    };
  }
}
