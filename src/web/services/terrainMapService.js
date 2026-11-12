/**
 * Terrain Map Service Facade
 * Coordinates modular terrain services under ./terrain/ (areaMapGenerator, terrainReliefScanner,
 * sceneVerifier, smartPathGenerator).
 */

import { generateAreaMapData, generateTerrainXray } from './terrain/areaMapGenerator.js';
import { scan3DTerrainRelief } from './terrain/terrainReliefScanner.js';
import { analyzeSceneVerifier } from './terrain/sceneVerifier.js';
import { generateSmartPathBetweenObjects } from './terrain/smartPathGenerator.js';

export {
  generateAreaMapData,
  generateTerrainXray,
  scan3DTerrainRelief,
  analyzeSceneVerifier,
  generateSmartPathBetweenObjects
};
