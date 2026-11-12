import fs from 'fs';
import path from 'path';
import os from 'os';
import { logger } from './logger.js';

export const BYPASS_FABRIC_CHECK_URL = 'https://cdn.modrinth.com/data/yhxBQd3K/versions/TBjYyIM0/bypass-fabric-check-1.0.11.jar';
export const BYPASS_FABRIC_CHECK_FILENAME = 'bypass-fabric-check-1.0.11.jar';
export const MODRINTH_PROJECT_URL = 'https://modrinth.com/mod/bypass-fabric-check';

/**
 * Scans local directories for known Minecraft launcher instances and profiles.
 * Detects CurseForge, Prism Launcher, Modrinth App, and default .minecraft locations.
 *
 * @returns {Array<{name: string, launcher: string, instanceDir: string, modsDir: string, modsDirExists: boolean, hasBypassMod: boolean, gameVersion?: string, bypassJarName?: string}>}
 */
export function detectMinecraftInstances() {
  const instances = [];
  const home = os.homedir();
  const appdata = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppdata = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');

  // Candidate roots across launchers and platforms
  const candidateRoots = [
    // 1. CurseForge
    { launcher: 'CurseForge', root: path.join(home, 'curseforge', 'minecraft', 'Instances') },
    { launcher: 'CurseForge', root: path.join(home, 'Documents', 'curseforge', 'minecraft', 'Instances') },
    // 2. Prism Launcher
    { launcher: 'Prism Launcher', root: path.join(appdata, 'PrismLauncher', 'instances') },
    { launcher: 'Prism Launcher', root: path.join(home, '.local', 'share', 'PrismLauncher', 'instances') },
    // 3. Modrinth App
    { launcher: 'Modrinth App', root: path.join(appdata, 'ModrinthApp', 'profiles') },
    { launcher: 'Modrinth App', root: path.join(home, '.local', 'share', 'ModrinthApp', 'profiles') },
    // 4. MultiMC
    { launcher: 'MultiMC', root: path.join(appdata, 'MultiMC', 'instances') },
    // 5. ATLauncher
    { launcher: 'ATLauncher', root: path.join(appdata, 'ATLauncher', 'instances') }
  ];

  for (const { launcher, root } of candidateRoots) {
    if (!fs.existsSync(root)) continue;
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const instDir = path.join(root, entry.name);
        // In Prism/MultiMC, mods are under .minecraft/mods
        let modsDir = path.join(instDir, 'mods');
        if (!fs.existsSync(modsDir) && fs.existsSync(path.join(instDir, '.minecraft', 'mods'))) {
          modsDir = path.join(instDir, '.minecraft', 'mods');
        }

        const modsDirExists = fs.existsSync(modsDir);
        let hasBypassMod = false;
        let bypassJarName = null;

        if (modsDirExists) {
          try {
            const files = fs.readdirSync(modsDir);
            for (const f of files) {
              if (/bypass.*fabric.*check.*\.jar$/i.test(f) || /bypass-fabric-check/i.test(f)) {
                hasBypassMod = true;
                bypassJarName = f;
                break;
              }
            }
          } catch {}
        }

        // Try extracting game version if metadata file exists
        let gameVersion = null;
        try {
          const curseJson = path.join(instDir, 'minecraftinstance.json');
          if (fs.existsSync(curseJson)) {
            const parsed = JSON.parse(fs.readFileSync(curseJson, 'utf8'));
            gameVersion = parsed.gameVersion || null;
          }
        } catch {}

        instances.push({
          name: `${entry.name} (${launcher})`,
          rawName: entry.name,
          launcher,
          instanceDir: instDir,
          modsDir,
          modsDirExists,
          hasBypassMod,
          bypassJarName,
          gameVersion
        });
      }
    } catch (err) {
      logger.debug(`[InstanceDetector] Fehler beim Lesen von ${root}: ${err.message}`);
    }
  }

  // 6. Default .minecraft
  const defaultMc = path.join(appdata, '.minecraft');
  if (fs.existsSync(defaultMc)) {
    const modsDir = path.join(defaultMc, 'mods');
    const modsDirExists = fs.existsSync(modsDir);
    let hasBypassMod = false;
    let bypassJarName = null;
    if (modsDirExists) {
      try {
        const files = fs.readdirSync(modsDir);
        for (const f of files) {
          if (/bypass.*fabric.*check.*\.jar$/i.test(f) || /bypass-fabric-check/i.test(f)) {
            hasBypassMod = true;
            bypassJarName = f;
            break;
          }
        }
      } catch {}
    }
    instances.push({
      name: 'Standard .minecraft',
      rawName: '.minecraft',
      launcher: 'Vanilla / Default',
      instanceDir: defaultMc,
      modsDir,
      modsDirExists,
      hasBypassMod,
      bypassJarName,
      gameVersion: null
    });
  }

  return instances;
}

/**
 * Finds the most relevant instance, prioritizing matching gameVersion or existing mods directory.
 *
 * @param {string} [preferredVersion] - e.g. '26.3' or '1.21.4'
 * @returns {Object|null}
 */
export function findBestMatchingInstance(preferredVersion = null) {
  const instances = detectMinecraftInstances();
  if (instances.length === 0) return null;

  if (preferredVersion) {
    const match = instances.find(i => i.gameVersion === preferredVersion && i.modsDirExists);
    if (match) return match;
    const matchAny = instances.find(i => i.gameVersion === preferredVersion);
    if (matchAny) return matchAny;
  }

  // Next: Prioritize instances where mods folder already exists
  const withMods = instances.filter(i => i.modsDirExists);
  if (withMods.length > 0) {
    // If one contains other fabric mods, prefer it
    return withMods[0];
  }

  return instances[0];
}

/**
 * Installs (downloads or copies) the Bypass Fabric Check mod into the specified mods directory.
 *
 * @param {string} targetModsDir - Destination mods directory
 * @param {string} [downloadUrl] - Optional custom download URL
 * @returns {Promise<{success: boolean, targetPath: string, filename: string, error?: string}>}
 */
export async function installBypassMod(targetModsDir, downloadUrl = BYPASS_FABRIC_CHECK_URL) {
  if (!targetModsDir) {
    const best = findBestMatchingInstance();
    if (!best) {
      return { success: false, error: 'Keine Minecraft-Instanz auf diesem Computer gefunden.' };
    }
    targetModsDir = best.modsDir;
  }

  try {
    if (!fs.existsSync(targetModsDir)) {
      fs.mkdirSync(targetModsDir, { recursive: true });
    }

    const targetFile = path.join(targetModsDir, BYPASS_FABRIC_CHECK_FILENAME);

    // If already exists and is non-empty, avoid redundant download
    if (fs.existsSync(targetFile)) {
      const stats = fs.statSync(targetFile);
      if (stats.size > 1000) {
        logger.info(`[InstanceDetector] Bypass Fabric Check ist bereits vorhanden: ${targetFile}`);
        return { success: true, targetPath: targetFile, filename: BYPASS_FABRIC_CHECK_FILENAME, alreadyExisted: true };
      }
    }

    logger.info(`[InstanceDetector] Lade Bypass Fabric Check herunter von ${downloadUrl}...`);
    const resp = await fetch(downloadUrl);
    if (!resp.ok) {
      throw new Error(`Download fehlgeschlagen (HTTP ${resp.status} ${resp.statusText})`);
    }

    const buffer = Buffer.from(await resp.arrayBuffer());
    if (buffer.length < 1000) {
      throw new Error('Heruntergeladene Mod-Datei ist unvollständig oder ungültig.');
    }

    fs.writeFileSync(targetFile, buffer);
    logger.info(`[InstanceDetector] Bypass Fabric Check erfolgreich installiert in: ${targetFile} (${buffer.length} Bytes)`);

    return {
      success: true,
      targetPath: targetFile,
      filename: BYPASS_FABRIC_CHECK_FILENAME,
      bytes: buffer.length
    };
  } catch (err) {
    logger.error(`[InstanceDetector] Fehler beim Installieren der Bypass-Mod: ${err.message}`);
    return { success: false, error: err.message, targetPath: targetModsDir };
  }
}

/**
 * Automatically discovers local Minecraft Singleplayer worlds (saves/* with region/*.mca)
 * and external Litematica / WorldEdit schematics across all detected launcher instances.
 *
 * @param {Array<{name?: string, launcher?: string, instanceDir: string}>} [customInstances] - Optional custom instances for testing
 * @returns {{ worlds: Array<{id: string, name: string, launcher: string, worldDir: string, regionDir: string, regionCount: number, suggestedCenter: {x: number, z: number}, lastModified: number}>, externalSchematics: Array<{name: string, launcher: string, fullPath: string, size: number, format: string}> }}
 */
export function discoverLocalWorldsAndSchematics(customInstances = null) {
  const instances = Array.isArray(customInstances) ? customInstances : detectMinecraftInstances();
  const worlds = [];
  const externalSchematics = [];
  const seenWorldDirs = new Set();
  const seenSchemPaths = new Set();
  const allowedExts = new Set(['.schem', '.schematic', '.litematic', '.nbt']);

  for (const inst of instances) {
    if (!inst || !inst.instanceDir) continue;
    const baseDir = fs.existsSync(path.join(inst.instanceDir, '.minecraft'))
      ? path.join(inst.instanceDir, '.minecraft')
      : inst.instanceDir;

    // 1. Discover Singleplayer Saves (saves/<world>/region/*.mca)
    const savesDir = path.join(baseDir, 'saves');
    if (fs.existsSync(savesDir)) {
      try {
        const entries = fs.readdirSync(savesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          const worldDir = path.join(savesDir, entry.name);
          const normWorldDir = path.resolve(worldDir);
          if (seenWorldDirs.has(normWorldDir)) continue;

          const regionDir = path.join(worldDir, 'region');
          if (!fs.existsSync(regionDir)) continue;

          try {
            const regionFiles = fs.readdirSync(regionDir).filter(f => /^r\.-?\d+\.-?\d+\.mca$/i.test(f));
            if (regionFiles.length === 0) continue;

            seenWorldDirs.add(normWorldDir);

            // Pick region closest to (0,0) for suggested center
            let bestRx = 0;
            let bestRz = 0;
            let bestDist = Infinity;
            let latestMtime = 0;

            for (const rf of regionFiles) {
              const m = rf.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/i);
              if (m) {
                const rx = parseInt(m[1], 10);
                const rz = parseInt(m[2], 10);
                const dist = Math.abs(rx) + Math.abs(rz);
                if (dist < bestDist) {
                  bestDist = dist;
                  bestRx = rx;
                  bestRz = rz;
                }
              }
              try {
                const st = fs.statSync(path.join(regionDir, rf));
                if (st.mtimeMs > latestMtime) latestMtime = st.mtimeMs;
              } catch {}
            }

            worlds.push({
              id: Buffer.from(normWorldDir).toString('base64url'),
              name: entry.name,
              launcher: inst.launcher || inst.name || 'Local',
              worldDir: normWorldDir,
              worldPath: normWorldDir,
              regionDir: path.resolve(regionDir),
              regionCount: regionFiles.length,
              spawn: {
                x: bestRx * 512 + 256,
                z: bestRz * 512 + 256
              },
              suggestedCenter: {
                x: bestRx * 512 + 256,
                z: bestRz * 512 + 256
              },
              lastModified: latestMtime || Date.now()
            });
          } catch {}
        }
      } catch {}
    }

    // 2. Discover local Litematica & WorldEdit schematics folders
    const candidateSchemDirs = [
      path.join(baseDir, 'schematics'),
      path.join(baseDir, 'config', 'worldedit', 'schematics'),
      path.join(baseDir, 'config', 'litematica', 'schematics')
    ];

    for (const sDir of candidateSchemDirs) {
      if (!fs.existsSync(sDir)) continue;
      try {
        const files = fs.readdirSync(sDir, { withFileTypes: true });
        for (const f of files) {
          if (!f.isFile()) continue;
          const ext = path.extname(f.name).toLowerCase();
          if (!allowedExts.has(ext)) continue;
          const fullPath = path.resolve(sDir, f.name);
          if (seenSchemPaths.has(fullPath)) continue;
          seenSchemPaths.add(fullPath);

          try {
            const st = fs.statSync(fullPath);
            externalSchematics.push({
              id: Buffer.from(fullPath).toString('base64url'),
              name: f.name,
              filename: f.name,
              launcher: inst.launcher || inst.name || 'Local',
              instanceName: inst.rawName || inst.name || 'Local',
              fullPath,
              filePath: fullPath,
              size: st.size,
              format: ext.replace('.', ''),
              modified: st.mtime
            });
          } catch {}
        }
      } catch {}
    }
  }

  worlds.sort((a, b) => b.lastModified - a.lastModified);
  return { worlds, externalSchematics, schematics: externalSchematics };
}

