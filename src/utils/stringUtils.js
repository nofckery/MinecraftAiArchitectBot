import { findBestMatchingInstance } from './minecraftInstanceDetector.js';

/**
 * Computes Levenshtein distance between two strings for fuzzy matching.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  const strA = a === null || a === undefined ? '' : String(a);
  const strB = b === null || b === undefined ? '' : String(b);
  if (strA.length === 0) return strB.length;
  if (strB.length === 0) return strA.length;
  const matrix = [];
  for (let i = 0; i <= strB.length; i++) matrix[i] = [i];
  for (let j = 0; j <= strA.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= strB.length; i++) {
    for (let j = 1; j <= strA.length; j++) {
      if (strB.charAt(i - 1) === strA.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[strB.length][strA.length];
}

/**
 * Recursively extracts plain text from Minecraft chat components, JSON chat trees,
 * or prismarine-nbt compound structures sent by Minecraft servers upon kick/disconnect.
 *
 * @param {any} reason - Chat component, NBT compound object, JSON string, or primitive
 * @returns {string} Clean, unformatted readable text
 */
export function extractMinecraftChatText(reason) {
  if (reason === null || reason === undefined) return '';

  if (typeof reason === 'string') {
    const trimmed = reason.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return extractMinecraftChatText(parsed);
      } catch {
        return reason;
      }
    }
    return reason;
  }

  if (typeof reason !== 'object') {
    return String(reason);
  }

  // Handle prismarine-nbt wrapped structures
  // E.g. { type: 'compound', value: { text: { type: 'string', value: 'Hello' } } }
  // or { type: 'string', value: 'Hello' }
  // or { type: 'list', value: { type: 'compound', value: [...] } }
  if (reason.type && reason.value !== undefined) {
    if (reason.type === 'string') {
      return String(reason.value);
    }
    if (reason.type === 'list' && reason.value) {
      const list = Array.isArray(reason.value.value)
        ? reason.value.value
        : (Array.isArray(reason.value) ? reason.value : []);
      return list.map(extractMinecraftChatText).join('');
    }
    if (reason.type === 'compound' && typeof reason.value === 'object') {
      return extractMinecraftChatText(reason.value);
    }
  }

  let text = '';

  // Check text property (may be string or nested NBT object)
  if (reason.text !== undefined) {
    if (typeof reason.text === 'object' && reason.text !== null) {
      text += reason.text.value !== undefined ? String(reason.text.value) : extractMinecraftChatText(reason.text);
    } else {
      text += String(reason.text);
    }
  }

  // Check anonymous/empty key (used in some NBT compound text lists: {"": {"type": "string", "value": "..."}})
  if (reason[''] !== undefined) {
    if (typeof reason[''] === 'object' && reason[''] !== null) {
      text += reason[''].value !== undefined ? String(reason[''].value) : extractMinecraftChatText(reason['']);
    } else {
      text += String(reason['']);
    }
  }

  // Check translate
  if (reason.translate !== undefined) {
    const tr = typeof reason.translate === 'object' && reason.translate?.value !== undefined
      ? reason.translate.value
      : reason.translate;
    text += String(tr);
  }

  // Check extra property (arrays or compound lists of chat components)
  if (reason.extra !== undefined) {
    const extraVal = (typeof reason.extra === 'object' && reason.extra?.value !== undefined)
      ? reason.extra.value
      : reason.extra;

    if (Array.isArray(extraVal)) {
      text += extraVal.map(extractMinecraftChatText).join('');
    } else if (extraVal && typeof extraVal === 'object') {
      if (Array.isArray(extraVal.value)) {
        text += extraVal.value.map(extractMinecraftChatText).join('');
      } else {
        text += extractMinecraftChatText(extraVal);
      }
    }
  }

  // Check with array (for translate arguments)
  if (reason.with !== undefined) {
    const withVal = (typeof reason.with === 'object' && reason.with?.value !== undefined)
      ? reason.with.value
      : reason.with;
    if (Array.isArray(withVal)) {
      text += ' ' + withVal.map(extractMinecraftChatText).join(' ');
    }
  }

  return text;
}

/**
 * Classifies Minecraft kick / disconnect reasons to provide targeted diagnostics,
 * particularly for Fabric Loader / Fabric API mod synchronization mismatches.
 *
 * @param {any} reason - Kick reason from Mineflayer
 * @returns {Object} Diagnostic classification
 */
export function classifyKickReason(reason) {
  const cleanText = extractMinecraftChatText(reason).trim();
  const rawStr = typeof reason === 'object' ? JSON.stringify(reason) : String(reason);
  const combinedLower = `${cleanText} ${rawStr}`.toLowerCase();

  // 1. Fabric Loader & Fabric API / Registry Synchronization Mismatch
  const isFabricMismatch =
    combinedLower.includes('fabric loader and fabric api') ||
    combinedLower.includes('fabric-registry-sync') ||
    combinedLower.includes('fabric:registry/sync') ||
    combinedLower.includes('registry entry namespaces may be related') ||
    (combinedLower.includes('this server requires') && combinedLower.includes('fabric'));

  if (isFabricMismatch) {
    // Extract related mod namespaces from text
    const namespaces = [];
    const match = cleanText.match(/namespaces may be related:\s*([\s\S]*?)(?:Contact the server|$)/i);
    if (match && match[1]) {
      const tokens = match[1]
        .split(/[\r\n\s,]+/)
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 0 && /^[a-z0-9_\-]+$/.test(t));
      for (const tok of tokens) {
        if (!namespaces.includes(tok)) namespaces.push(tok);
      }
    }

    let detectedInstance = null;
    try {
      detectedInstance = findBestMatchingInstance();
    } catch {}

    let recText = 'Installiere die Server-Mod "Bypass Fabric Check" (Modrinth) auf deinem Host/LAN-Rechner im mods-Ordner, damit BaumeisterKI (Vanilla-Bot) deiner LAN-Welt direkt beitreten kann.';
    if (detectedInstance) {
      if (detectedInstance.hasBypassMod) {
        recText = `Die Mod "Bypass Fabric Check" ist bereits in deiner Minecraft-Instanz "${detectedInstance.name}" (${detectedInstance.modsDir}) installiert. Bitte starte Minecraft einmal komplett neu und öffne die Welt erneut im LAN, damit die Mod geladen wird!`;
      } else {
        recText = `Installiere die Server-Mod "Bypass Fabric Check" (Modrinth) in deiner Minecraft-Instanz "${detectedInstance.name}" (${detectedInstance.modsDir}), damit BaumeisterKI beitreten kann. Nutze die 1-Klick-Installation im Dashboard!`;
      }
    }

    return {
      isFabricMismatch: true,
      category: 'FABRIC_MOD_MISMATCH',
      cleanText: cleanText || 'This server requires Fabric Loader and Fabric API installed on your client!',
      rawReason: rawStr,
      title: 'Fabric Loader & Fabric API erforderlich (Mod-Mismatch)',
      message: 'Der Minecraft-Server erfordert Fabric Loader und Fabric API mit passenden Mods auf dem Client. Da BaumeisterKI ein Node.js/Vanilla-Bot ist, kann er keine Java-Client-Mods ausführen.',
      relatedNamespaces: namespaces,
      detectedInstance: detectedInstance ? {
        name: detectedInstance.name,
        rawName: detectedInstance.rawName,
        launcher: detectedInstance.launcher,
        modsDir: detectedInstance.modsDir,
        hasBypassMod: detectedInstance.hasBypassMod,
        bypassJarName: detectedInstance.bypassJarName,
        gameVersion: detectedInstance.gameVersion
      } : null,
      recommendation: recText,
      modrinthUrl: 'https://modrinth.com/mod/bypass-fabric-check',
      githubUrl: 'https://github.com/tlwsy/bypass-fabric-check'
    };
  }

  // 2. Duplicate Login / Handoff
  if (
    combinedLower.includes('duplicate_login') ||
    combinedLower.includes('logged in from another location') ||
    combinedLower.includes('anderem ort angemeldet') ||
    combinedLower.includes('already connected')
  ) {
    return {
      isFabricMismatch: false,
      isDuplicateLogin: true,
      category: 'DUPLICATE_LOGIN',
      cleanText,
      rawReason: rawStr,
      title: 'Doppelte Anmeldung',
      message: 'Ein anderer Spieler mit diesem Namen ist bereits auf dem Server verbunden.'
    };
  }

  // 3. Outdated Client or Server Version
  if (
    combinedLower.includes('outdated server') ||
    combinedLower.includes('outdated client') ||
    combinedLower.includes('server version')
  ) {
    return {
      isFabricMismatch: false,
      isOutdated: true,
      category: 'VERSION_MISMATCH',
      cleanText,
      rawReason: rawStr,
      title: 'Minecraft Versionskonflikt',
      message: cleanText || 'Die Minecraft-Version des Bots stimmt nicht mit dem Server überein.'
    };
  }

  // 4. Default / Generic Kick
  return {
    isFabricMismatch: false,
    category: 'OTHER',
    cleanText: cleanText || rawStr,
    rawReason: rawStr,
    title: 'Vom Server getrennt',
    message: cleanText || rawStr
  };
}
