/**
 * High-Level Prozedurales Architektur-SDK (ArchPrimitives)
 * Stellt dem LLM ein mächtiges, fehlertolerantes Methoden-Repertoire für
 * professionelle mittelalterliche und organische Minecraft-Architektur bereit.
 *
 * Facade-Klasse delegiert an spezialisierte Submodule in src/builder/primitives/.
 */

import { createSmartPalette } from '../utils/noise.js';
import { foundation, framedRoom, jettyFloor } from './primitives/roomGenerators.js';
import { gableRoof, hipRoof, conicalTowerRoof } from './primitives/roofGenerators.js';
import { cylindricalTower, windowWithDetail, doorway, chimney } from './primitives/structureGenerators.js';
import { furnishInterior } from './primitives/interiorDecorators.js';

export {
  foundation,
  framedRoom,
  jettyFloor,
  gableRoof,
  hipRoof,
  conicalTowerRoof,
  cylindricalTower,
  windowWithDetail,
  doorway,
  chimney,
  furnishInterior
};

export class ArchPrimitives {
  constructor(canvas) {
    this.canvas = canvas;
  }

  /**
   * 1. Smart-Palette erstellen
   */
  palette(def, opts = {}) {
    return createSmartPalette(def, opts);
  }

  /**
   * 2. Fundament & Hangabstützung
   */
  foundation(x1, z1, x2, z2, height = 1, palette = 'stone_bricks', terrainMap = null) {
    return foundation(this.canvas, x1, z1, x2, z2, height, palette, terrainMap);
  }

  /**
   * 3. Fachwerk-Stockwerk mit Tiefenstaffelung (Pfeiler, Rahmenbalken, Wandeinzug)
   */
  framedRoom(x1, y1, z1, x2, y2, z2, opts = {}) {
    return framedRoom(this.canvas, x1, y1, z1, x2, y2, z2, opts);
  }

  /**
   * 4. Vorkragender Fachwerk-Oberbau (Jetty Floor)
   */
  jettyFloor(x1, y1, z1, x2, y2, z2, opts = {}) {
    return jettyFloor(this.canvas, x1, y1, z1, x2, y2, z2, opts);
  }

  /**
   * 5. Satteldach / Giebeldach
   */
  gableRoof(x1, y, z1, x2, z2, opts = {}) {
    return gableRoof(this.canvas, x1, y, z1, x2, z2, opts);
  }

  /**
   * 6. Vierseitiges Walmdach (Hip Roof)
   */
  hipRoof(x1, y, z1, x2, z2, opts = {}) {
    return hipRoof(this.canvas, x1, y, z1, x2, z2, opts);
  }

  /**
   * 7. Konisches Turmdach (Kegel-/Hexendach)
   */
  conicalTowerRoof(cx, y, cz, radius, height, opts = {}) {
    return conicalTowerRoof(this.canvas, cx, y, cz, radius, height, opts);
  }

  /**
   * 8. Runder Turm mit Wendeltreppe, Buttresses & Zinnenkranz
   */
  cylindricalTower(cx, y1, cz, radius, height, opts = {}) {
    return cylindricalTower(this.canvas, cx, y1, cz, radius, height, opts);
  }

  /**
   * 9. Detailliertes Fenster mit Läden, Sturz & Blumenbrett
   */
  windowWithDetail(x, y, z, w = 1, h = 2, facing = 'north', opts = {}) {
    return windowWithDetail(this.canvas, x, y, z, w, h, facing, opts);
  }

  /**
   * 10. Portal & Eingangstür mit Stufe, Überbogen und Laterne
   */
  doorway(x, y, z, facing = 'north', opts = {}) {
    return doorway(this.canvas, x, y, z, facing, opts);
  }

  /**
   * 11. Kamin & Schornstein mit echten Rauchpartikeln
   */
  chimney(x, yStart, z, yEnd, brickPalette = 'bricks') {
    return chimney(this.canvas, x, yStart, z, yEnd, brickPalette);
  }

  /**
   * 12. Prozedurale Inneneinrichtung ohne Blockieren von Türen & Laufwegen
   */
  furnishInterior(x1, y, z1, x2, z2, roomType = 'tavern') {
    return furnishInterior(this.canvas, x1, y, z1, x2, z2, roomType);
  }
}
