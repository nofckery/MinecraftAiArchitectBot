import dgram from 'node:dgram';
import EventEmitter from 'node:events';
import os from 'node:os';
import { logger } from '../utils/logger.js';

export const MC_LAN_MULTICAST_GROUP = '224.0.2.60';
export const MC_LAN_PORT = 4445;
export const MC_LAN_EXPIRY_MS = 8000;

/**
 * LanDiscoveryService listens for Minecraft "Open to LAN" UDP multicast broadcasts
 * on 224.0.2.60:4445 and maintains a live list of locally discoverable Minecraft worlds.
 */
export class LanDiscoveryService extends EventEmitter {
  constructor(options = {}) {
    super();
    this.multicastGroup = options.multicastGroup || MC_LAN_MULTICAST_GROUP;
    this.port = options.port || MC_LAN_PORT;
    this.expiryMs = options.expiryMs || MC_LAN_EXPIRY_MS;

    this.socket = null;
    this.isListening = false;
    this.expiryInterval = null;
    this.discoveredWorlds = new Map();
  }

  /**
   * Starts listening for Minecraft LAN multicast packets.
   * Safe to call multiple times or when port 4445 is already in use by another tool.
   */
  start() {
    if (this.socket || this.isListening) return;

    try {
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

      this.socket.on('error', (err) => {
        logger.debug(`[LanDiscovery] UDP-Socket Hinweis (${err.message}). LAN-Scanner läuft im passiven Modus.`);
        this.isListening = false;
        try {
          this.socket.close();
        } catch {}
        this.socket = null;
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handleMessage(msg, rinfo);
      });

      this.socket.bind(this.port, () => {
        this.isListening = true;
        try {
          this.socket.addMembership(this.multicastGroup);
        } catch (memErr) {
          logger.debug(`[LanDiscovery] Standard-addMembership Hinweis: ${memErr.message}`);
        }

        // Multicast auf allen aktiven IPv4-Netzwerkadaptern abonnieren (wichtig für Windows & Multi-NIC)
        try {
          const ifaces = os.networkInterfaces();
          for (const list of Object.values(ifaces)) {
            if (!list) continue;
            for (const iface of list) {
              if (iface.family === 'IPv4' && iface.address) {
                try {
                  this.socket.addMembership(this.multicastGroup, iface.address);
                } catch {}
              }
            }
          }
        } catch {}

        logger.info(`[LanDiscovery] Minecraft LAN-World Scanner aktiv auf Multicast ${this.multicastGroup}:${this.port}`);
      });
    } catch (err) {
      logger.debug(`[LanDiscovery] Konnte UDP-Socket nicht initialisieren: ${err.message}`);
      this.isListening = false;
      this.socket = null;
    }

    if (!this.expiryInterval) {
      this.expiryInterval = setInterval(() => this.cleanupExpiredWorlds(), 2500);
      if (typeof this.expiryInterval.unref === 'function') {
        this.expiryInterval.unref();
      }
    }
  }

  /**
   * Stops the LAN discovery listener and clears active socket/timers.
   */
  stop() {
    if (this.expiryInterval) {
      clearInterval(this.expiryInterval);
      this.expiryInterval = null;
    }

    if (this.socket) {
      try {
        if (this.isListening) {
          try {
            this.socket.dropMembership(this.multicastGroup);
          } catch {}
        }
        this.socket.close();
      } catch {}
      this.socket = null;
    }

    this.isListening = false;
    this.discoveredWorlds.clear();
  }

  /**
   * Parses Minecraft LAN broadcast message format:
   * [MOTD]World Name or Description[/MOTD][AD]Port[/AD]
   */
  handleMessage(msg, rinfo) {
    const text = typeof msg === 'string' ? msg : msg.toString('utf8');
    const regex = /\[MOTD\]([\s\S]*?)\[\/MOTD\]\s*\[AD\](\d+)\[\/AD\]/i;
    const match = text.match(regex);

    if (!match) return;

    const rawMotd = match[1]?.trim() || 'Minecraft LAN-Welt';
    // Entferne Minecraft Formatierungs-Codes (§a, §l, etc.) für saubere Dashboard-Darstellung
    const motd = rawMotd.replace(/§[0-9a-fk-or]/gi, '').trim() || rawMotd;
    const port = parseInt(match[2], 10);
    if (Number.isNaN(port) || port < 1 || port > 65535) return;

    const rawHost = rinfo?.address || '127.0.0.1';
    let host = rawHost;
    if (host.startsWith('::ffff:')) {
      host = host.slice(7);
    }
    if (host === '::1') {
      host = '127.0.0.1';
    }

    const worldId = `${host}:${port}`;
    const existing = this.discoveredWorlds.get(worldId);
    const isNew = !existing;
    const motdChanged = existing && (existing.motd !== motd || existing.rawMotd !== rawMotd);

    const worldInfo = {
      id: worldId,
      motd,
      rawMotd,
      port,
      host,
      remoteAddress: rawHost,
      lastSeen: Date.now()
    };

    this.discoveredWorlds.set(worldId, worldInfo);

    if (isNew) {
      logger.info(`[LanDiscovery] Neue Minecraft LAN-Welt entdeckt: "${motd}" auf ${host}:${port}`);
      this.emit('world_discovered', worldInfo);
    }

    // Nur bei neuen Welten oder geändertem MOTD ein Update senden, um DOM-Thrashing und WS-Spam zu verhindern
    if (isNew || motdChanged) {
      this.emit('worlds_updated', this.getDiscoveredWorlds());
    }
  }

  /**
   * Drops discovered worlds that have not broadcast within expiryMs.
   */
  cleanupExpiredWorlds() {
    const now = Date.now();
    let changed = false;

    for (const [key, world] of this.discoveredWorlds.entries()) {
      if (now - world.lastSeen > this.expiryMs) {
        this.discoveredWorlds.delete(key);
        changed = true;
      }
    }

    if (changed) {
      this.emit('worlds_updated', this.getDiscoveredWorlds());
    }
  }

  /**
   * Returns list of currently active LAN worlds.
   * @returns {Array<{ id: string, motd: string, port: number, host: string, lastSeen: number }>}
   */
  getDiscoveredWorlds() {
    return Array.from(this.discoveredWorlds.values());
  }

  /**
   * Injects a discovered world for testing or simulation.
   */
  mockDiscoverWorld(motd, port, host = '127.0.0.1') {
    const rawMotd = motd || 'Mock LAN World';
    const cleanMotd = rawMotd.replace(/§[0-9a-fk-or]/gi, '').trim() || rawMotd;
    let cleanHost = host;
    if (cleanHost.startsWith('::ffff:')) {
      cleanHost = cleanHost.slice(7);
    }
    if (cleanHost === '::1') {
      cleanHost = '127.0.0.1';
    }
    const worldId = `${cleanHost}:${port}`;
    const worldInfo = {
      id: worldId,
      motd: cleanMotd,
      rawMotd,
      port: parseInt(port, 10),
      host: cleanHost,
      remoteAddress: host,
      lastSeen: Date.now()
    };
    this.discoveredWorlds.set(worldId, worldInfo);
    this.emit('world_discovered', worldInfo);
    this.emit('worlds_updated', this.getDiscoveredWorlds());
    return worldInfo;
  }
}

export const lanDiscoveryService = new LanDiscoveryService();
