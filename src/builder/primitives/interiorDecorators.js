/**
 * Prozedurale Inneneinrichtungs-Generatoren (InteriorDecorators)
 */

export function furnishInterior(canvas, x1, y, z1, x2, z2, roomType = 'tavern') {
  const minX = Math.min(x1, x2) + 1;
  const maxX = Math.max(x1, x2) - 1;
  const minZ = Math.min(z1, z2) + 1;
  const maxZ = Math.max(z1, z2) - 1;

  if (minX > maxX || minZ > maxZ) return;

  // Prüft, ob ein Feld für Möbel frei ist (nicht neben einer Tür)
  const isFree = (fx, fz) => {
    const b = canvas.get(fx, y, fz);
    if (b && b.name !== 'air') return false;

    // 1 Block Umkreis auf Türen prüfen
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const adj = canvas.get(fx + dx, y, fz + dz);
        if (adj && adj.name.endsWith('_door')) return false;
      }
    }
    return true;
  };

  switch (roomType) {
    case 'tavern': {
      // Tresen an einer Wand (z. B. Nordwand)
      let counterPlaced = 0;
      for (let x = minX; x <= maxX - 2 && counterPlaced < 3; x++) {
        if (isFree(x, minZ)) {
          canvas.set(x, y, minZ, 'barrel');
          counterPlaced++;
        }
      }
      if (counterPlaced > 0 && isFree(minX + counterPlaced, minZ)) {
        canvas.set(minX + counterPlaced, y, minZ, 'cauldron');
      }

      // Sitzecke in der Mitte/Süden
      const tableX = Math.floor((minX + maxX) / 2);
      const tableZ = Math.floor((minZ + maxZ) / 2);
      if (isFree(tableX, tableZ)) {
        canvas.set(tableX, y, tableZ, 'spruce_fence');
        canvas.set(tableX, y + 1, tableZ, 'red_carpet');
        if (isFree(tableX - 1, tableZ)) {
          canvas.set(tableX - 1, y, tableZ, 'spruce_stairs[facing=east,half=bottom]');
        }
        if (isFree(tableX + 1, tableZ)) {
          canvas.set(tableX + 1, y, tableZ, 'spruce_stairs[facing=west,half=bottom]');
        }
      }
      break;
    }

    case 'bedroom': {
      // Bett in einer geschützten Ecke
      if (isFree(minX, minZ) && isFree(minX, minZ + 1)) {
        canvas.set(minX, y, minZ + 1, 'red_bed[facing=north,part=foot]');
        canvas.set(minX, y, minZ, 'red_bed[facing=north,part=head]');
      }
      // Nachttisch & Bücher
      if (isFree(minX + 1, minZ)) {
        canvas.set(minX + 1, y, minZ, 'crafting_table');
        canvas.set(minX + 1, y + 1, minZ, 'flower_pot');
      }
      if (isFree(maxX, minZ)) {
        canvas.set(maxX, y, minZ, 'bookshelf');
        canvas.set(maxX, y + 1, minZ, 'lantern[hanging=false]');
      }
      // Teppich vor dem Bett
      if (isFree(minX + 1, minZ + 1)) {
        canvas.set(minX + 1, y, minZ + 1, 'red_carpet');
      }
      break;
    }

    case 'smithy': {
      // Schmiede-Inventar
      if (isFree(minX, minZ)) canvas.set(minX, y, minZ, 'blast_furnace');
      if (isFree(minX + 1, minZ)) canvas.set(minX + 1, y, minZ, 'anvil');
      if (isFree(maxX, minZ)) canvas.set(maxX, y, minZ, 'grindstone');
      if (isFree(minX, maxZ)) canvas.set(minX, y, maxZ, 'cauldron');
      if (isFree(maxX, maxZ)) canvas.set(maxX, y, maxZ, 'smithing_table');
      break;
    }

    case 'library': {
      // Bücherregal-Reihen
      for (let x = minX; x <= maxX; x += 2) {
        if (isFree(x, minZ)) {
          canvas.set(x, y, minZ, 'bookshelf');
          canvas.set(x, y + 1, minZ, 'bookshelf');
        }
      }
      const midX = Math.floor((minX + maxX) / 2);
      const midZ = Math.floor((minZ + maxZ) / 2);
      if (isFree(midX, midZ)) {
        canvas.set(midX, y, midZ, 'lectern');
        canvas.set(midX, y + 1, midZ, 'lantern[hanging=false]');
      }
      break;
    }

    case 'storage': {
      // Kisten und Fässer stapeln
      for (let z = minZ; z <= maxZ; z++) {
        if (isFree(minX, z)) {
          canvas.set(minX, y, z, 'barrel');
          canvas.set(minX, y + 1, z, 'barrel');
        }
        if (isFree(maxX, z)) {
          canvas.set(maxX, y, z, 'chest');
        }
      }
      break;
    }

    case 'alchemy': {
      // Braustand, Kessel, Regale
      if (isFree(minX, minZ)) canvas.set(minX, y, minZ, 'brewing_stand');
      if (isFree(minX + 1, minZ)) canvas.set(minX + 1, y, minZ, 'cauldron');
      if (isFree(maxX, minZ)) {
        canvas.set(maxX, y, minZ, 'bookshelf');
        canvas.set(maxX, y + 1, minZ, 'bookshelf');
      }
      break;
    }

    case 'kitchen': {
      // Räucherofen, Kessel, Arbeitsfläche, Fässer
      if (isFree(minX, minZ)) canvas.set(minX, y, minZ, 'smoker');
      if (isFree(minX + 1, minZ)) canvas.set(minX + 1, y, minZ, 'cauldron');
      if (isFree(minX + 2, minZ)) {
        canvas.set(minX + 2, y, minZ, 'barrel');
        canvas.set(minX + 2, y + 1, minZ, 'lantern[hanging=false]');
      }
      if (isFree(maxX, minZ)) canvas.set(maxX, y, minZ, 'crafting_table');
      break;
    }

    case 'armory': {
      // Schmiedetisch, Schleifstein, Amboss, Waffenkisten
      if (isFree(minX, minZ)) canvas.set(minX, y, minZ, 'smithing_table');
      if (isFree(minX + 1, minZ)) canvas.set(minX + 1, y, minZ, 'anvil');
      if (isFree(maxX, minZ)) canvas.set(maxX, y, minZ, 'grindstone');
      if (isFree(maxX, maxZ)) canvas.set(maxX, y, maxZ, 'chest');
      break;
    }

    case 'workshop': {
      // Werkbank, Steinsäge, Schmelzofen, Webstuhl
      if (isFree(minX, minZ)) canvas.set(minX, y, minZ, 'crafting_table');
      if (isFree(minX + 1, minZ)) canvas.set(minX + 1, y, minZ, 'stonecutter');
      if (isFree(maxX, minZ)) canvas.set(maxX, y, minZ, 'blast_furnace');
      if (isFree(minX, maxZ)) canvas.set(minX, y, maxZ, 'loom');
      break;
    }

    case 'chapel': {
      // Altar in der Mitte, Lesepult, Bänke
      const midX = Math.floor((minX + maxX) / 2);
      if (isFree(midX, minZ)) {
        canvas.set(midX, y, minZ, 'chiseled_stone_bricks');
        canvas.set(midX, y + 1, minZ, 'candle[lit=true]');
      }
      if (isFree(midX - 1, minZ + 2)) canvas.set(midX - 1, y, minZ + 2, 'spruce_stairs[facing=south,half=bottom]');
      if (isFree(midX + 1, minZ + 2)) canvas.set(midX + 1, y, minZ + 2, 'spruce_stairs[facing=south,half=bottom]');
      break;
    }

    case 'throne': {
      // Thronsitz mit Stufen und Gold/Banner-Deko
      const midX = Math.floor((minX + maxX) / 2);
      if (isFree(midX, minZ)) {
        canvas.set(midX, y, minZ, 'smooth_quartz_stairs[facing=south,half=bottom]');
        canvas.set(midX - 1, y, minZ, 'smooth_quartz_slab');
        canvas.set(midX + 1, y, minZ, 'smooth_quartz_slab');
        canvas.set(midX, y + 1, minZ, 'gold_block');
      }
      break;
    }

    default: {
      // Robuster Default-Fallback: Gemütlicher Basistisch mit Stühlen, Laterne & Kiste
      const midX = Math.floor((minX + maxX) / 2);
      const midZ = Math.floor((minZ + maxZ) / 2);
      if (isFree(midX, midZ)) {
        canvas.set(midX, y, midZ, 'spruce_fence');
        canvas.set(midX, y + 1, midZ, 'lantern[hanging=false]');
      }
      if (isFree(midX - 1, midZ)) {
        canvas.set(midX - 1, y, midZ, 'spruce_stairs[facing=east,half=bottom]');
      }
      if (isFree(midX + 1, midZ)) {
        canvas.set(midX + 1, y, midZ, 'spruce_stairs[facing=west,half=bottom]');
      }
      if (isFree(minX, minZ)) {
        canvas.set(minX, y, minZ, 'chest');
      }
      if (isFree(maxX, minZ)) {
        canvas.set(maxX, y, minZ, 'crafting_table');
      }
      break;
    }
  }
}
