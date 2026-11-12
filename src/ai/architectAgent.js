import { EventEmitter } from 'node:events';
import { VoxelCanvas } from '../builder/voxelCanvas.js';
import { llmRouter } from './llmRouter.js';
import { TASK_ROLES } from './modelKnowledgeBase.js';
import { blueprintMemory } from './blueprintMemory.js';
import { SYSTEM_ARCHITECT_PROMPT, createPitchPrompt } from './prompts.js';
import { logger } from '../utils/logger.js';
import { executeStudioAiCoPilot } from './studio/spatialCoPilot.js';
import { scanCustomBounds, getEffectiveSiteInfo } from './studio/siteScanner.js';
import {
  synthesizeBuildLoop,
  refineRegionLoop,
  remixSchematicLoop
} from './studio/buildSynthesisLoop.js';

export class ArchitectAgent extends EventEmitter {
  constructor(bot = null) {
    super();
    this.bot = bot;
    this.lastBuildState = null;
    this.pendingProposal = null;
    this.instantMode = false;
    this.customSiteInfo = null;
    this.studioSceneContext = {
      terrain: null,
      objects: [],
      activeObjectId: null,
      userDeltas: [],
      verifierSummary: null
    };
  }

  setStudioTerrainContext(terrain) {
    this.studioSceneContext.terrain = terrain;
  }

  recordUserStudioDelta(deltaText) {
    if (!deltaText) return;
    this.studioSceneContext.userDeltas.push(`[${new Date().toLocaleTimeString('de-DE')}] ${deltaText}`);
    if (this.studioSceneContext.userDeltas.length > 30) {
      this.studioSceneContext.userDeltas.shift();
    }
  }

  updateStudioSceneContext(snapshot = {}) {
    if (snapshot.terrain) {
      this.studioSceneContext.terrain = snapshot.terrain;
    }
    if (Array.isArray(snapshot.objects)) {
      this.studioSceneContext.objects = snapshot.objects;
    }
    if (snapshot.activeObjectId !== undefined) {
      this.studioSceneContext.activeObjectId = snapshot.activeObjectId;
    }
    if (Array.isArray(snapshot.userDeltas)) {
      for (const d of snapshot.userDeltas) {
        if (!this.studioSceneContext.userDeltas.includes(d)) {
          this.studioSceneContext.userDeltas.push(d);
        }
      }
      if (this.studioSceneContext.userDeltas.length > 30) {
        this.studioSceneContext.userDeltas = this.studioSceneContext.userDeltas.slice(-30);
      }
    }
    if (snapshot.verifierSummary) {
      this.studioSceneContext.verifierSummary = snapshot.verifierSummary;
    }

    // Synchronize active object's current blocks into lastBuildState.canvas so LLM sees all manual edits
    const activeObj = this.studioSceneContext.objects.find(o => o.id === this.studioSceneContext.activeObjectId)
      || this.studioSceneContext.objects[this.studioSceneContext.objects.length - 1];

    if (activeObj && Array.isArray(activeObj.blocks) && activeObj.blocks.length > 0) {
      const w = Math.max(16, activeObj.bounds?.width || activeObj.width || 16);
      const h = Math.max(24, activeObj.bounds?.height || activeObj.height || 24);
      const d = Math.max(16, activeObj.bounds?.depth || activeObj.depth || 16);
      const origin = activeObj.position || { x: 0, y: 64, z: 0 };
      const facing = activeObj.facing || 'north';
      const canvas = new VoxelCanvas(w, h, d, origin, facing);
      canvas.maxOps = Math.max(250000, activeObj.blocks.length + 50000);
      for (const b of activeObj.blocks) {
        if (b && b.name && b.name !== 'air') {
          canvas.set(b.x, b.y, b.z, { name: b.name, properties: b.properties || {} });
        }
      }
      this.lastBuildState = {
        code: activeObj.sourceCode || this.lastBuildState?.code || `// Studio Object: ${activeObj.name}`,
        origin: { ...origin },
        width: w,
        height: h,
        depth: d,
        facing,
        canvas,
        objectId: activeObj.id,
        objectName: activeObj.name
      };
    }
    return this.studioSceneContext;
  }

  setBot(bot) {
    this.bot = bot;
  }

  setInstantMode(enabled) {
    this.instantMode = !!enabled;
  }

  setCustomBounds(bounds) {
    this.customSiteInfo = scanCustomBounds(bounds, this.bot);
  }

  getEffectiveSiteInfo(username = null, customDimensions = null) {
    return getEffectiveSiteInfo(this.customSiteInfo, this.bot, username, customDimensions);
  }

  async createPitch(userRequest, siteInfo) {
    const recentStyles = blueprintMemory.getRecentStyles();
    const prompt = createPitchPrompt(userRequest, siteInfo, recentStyles);

    try {
      const pitch = await llmRouter.completeJSON(TASK_ROLES.NANO_CHAT, SYSTEM_ARCHITECT_PROMPT, prompt);
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
    const result = await synthesizeBuildLoop({
      userRequest,
      siteInfo,
      isModification,
      lastBuildState: this.lastBuildState,
      studioSceneContext: this.studioSceneContext
    });

    this.lastBuildState = result.newBuildState;

    const returnData = {
      canvas: result.canvas,
      diff: result.diff,
      lintReport: result.lintReport,
      code: result.code,
      siteInfo: result.siteInfo
    };

    try {
      this.emit('preview', {
        ...returnData,
        userRequest
      });
    } catch (err) {
      logger.warn(`Fehler beim Emitten des Preview-Events: ${err.message}`);
    }

    return returnData;
  }

  async refineRegionWithAI(instruction, selectionBox) {
    const fallbackSiteInfo = this.getEffectiveSiteInfo();
    const result = await refineRegionLoop({
      instruction,
      selectionBox,
      lastBuildState: this.lastBuildState,
      fallbackSiteInfo
    });

    if (!this.lastBuildState?.canvas) {
      this.lastBuildState = result.activeState;
    }
    this.lastBuildState.code = result.updatedCode;

    try {
      this.emit('preview', {
        canvas: result.canvas,
        lintReport: result.lintReport,
        siteInfo: result.siteInfo,
        userRequest: `[Region Edit] ${instruction}`
      });
    } catch (err) {
      logger.warn(`Fehler beim Emitten des Preview-Events: ${err.message}`);
    }

    return {
      canvas: result.canvas,
      lintReport: result.lintReport,
      code: result.code
    };
  }

  async remixImportedSchematic(instruction) {
    const result = await remixSchematicLoop({
      instruction,
      lastBuildState: this.lastBuildState
    });

    this.lastBuildState.code = result.updatedCode;

    try {
      this.emit('preview', {
        canvas: result.canvas,
        lintReport: result.lintReport,
        siteInfo: result.siteInfo,
        userRequest: `[Remix] ${instruction}`
      });
    } catch (err) {
      logger.warn(`Fehler beim Emitten des Preview-Events: ${err.message}`);
    }

    return {
      canvas: result.canvas,
      lintReport: result.lintReport,
      code: result.code
    };
  }

  /**
   * Omnipresent Spatial AI Co-Pilot für das CAD World Studio.
   * Delegiert an executeStudioAiCoPilot in src/ai/studio/spatialCoPilot.js.
   */
  async executeStudioAiCoPilot(params = {}) {
    return executeStudioAiCoPilot(this, params);
  }
}
