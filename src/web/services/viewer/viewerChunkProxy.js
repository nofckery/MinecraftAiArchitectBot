/**
 * Chunk Column & World Proxy for Viewer State Translation
 * Intercepts getColumn/getColumnAt to translate chunk palettes and single-value containers on-the-fly.
 */

export function translateChunkPalette(paletteArray, translateStateIdFn) {
  if (!Array.isArray(paletteArray)) return paletteArray;
  for (let i = 0; i < paletteArray.length; i++) {
    paletteArray[i] = translateStateIdFn(paletteArray[i]);
  }
  return paletteArray;
}

export function translateChunkJson(chunkJson, translateStateIdFn) {
  const isString = typeof chunkJson === 'string';
  let parsed;
  try {
    parsed = isString ? JSON.parse(chunkJson) : chunkJson;
  } catch {
    return chunkJson;
  }

  if (!parsed || !Array.isArray(parsed.sections)) {
    return chunkJson;
  }

  for (let i = 0; i < parsed.sections.length; i++) {
    const rawSection = parsed.sections[i];
    if (!rawSection) continue;

    try {
      const isSectionString = typeof rawSection === 'string';
      const section = isSectionString ? JSON.parse(rawSection) : rawSection;
      if (!section || !section.data) continue;

      const isDataString = typeof section.data === 'string';
      const data = isDataString ? JSON.parse(section.data) : section.data;

      if (data.type === 'indirect' && Array.isArray(data.palette)) {
        translateChunkPalette(data.palette, translateStateIdFn);
        section.data = isDataString ? JSON.stringify(data) : data;
      } else if (data.type === 'single' && typeof data.value === 'number') {
        data.value = translateStateIdFn(data.value);
        section.data = isDataString ? JSON.stringify(data) : data;
      }

      parsed.sections[i] = isSectionString ? JSON.stringify(section) : section;
    } catch {
      // Leave malformed individual section as-is
    }
  }

  return isString ? JSON.stringify(parsed) : parsed;
}

export function wrapChunkColumn(column, translateChunkJsonFn) {
  if (!column || column._isViewerProxy) return column;

  return new Proxy(column, {
    get(target, prop, receiver) {
      if (prop === '_isViewerProxy') return true;
      if (prop === 'toJson') {
        return function(...args) {
          const origJson = target.toJson(...args);
          return translateChunkJsonFn(origJson);
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}

export function wrapWorld(botWorld, wrapChunkColumnFn) {
  if (!botWorld) return botWorld;

  return new Proxy(botWorld, {
    get(target, prop, receiver) {
      if (prop === 'getColumnAt') {
        return async function(...args) {
          const column = await target.getColumnAt(...args);
          if (!column) return column;
          return wrapChunkColumnFn(column);
        };
      }
      if (prop === 'getColumn') {
        return function(...args) {
          const column = target.getColumn(...args);
          if (!column) return column;
          return wrapChunkColumnFn(column);
        };
      }
      const val = Reflect.get(target, prop, receiver);
      return typeof val === 'function' ? val.bind(target) : val;
    }
  });
}
