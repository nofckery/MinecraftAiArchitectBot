import { EventEmitter } from 'node:events';
import path from 'node:path';
import prismarineAuth from 'prismarine-auth';
import minecraftFolderPath from 'minecraft-folder-path';
import { logger } from '../utils/logger.js';

const { Authflow, Titles } = prismarineAuth;

/**
 * MsaAuthManager
 *
 * Verwaltet den Microsoft Authentication Flow (RFC 8628 Device Code)
 * für Minecraft Java Edition Accounts über prismarine-auth.
 * Bietet direkte Integration für das Onboarding-Web-Dashboard und Mineflayer.
 */
export class MsaAuthManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.cacheDir = options.cacheDir || path.join(minecraftFolderPath, 'nmp-cache');
    this.activeSessions = new Map();
    this.authTitles = options.authTitle || Titles?.MinecraftNintendoSwitch || '00000000441cc96b';
    this.deviceType = options.deviceType || 'Nintendo';
    this.flowType = options.flow || 'live';
  }

  /**
   * Prüft, ob für den angegebenen Spielernamen bereits ein gültiger Token-Cache existiert.
   * @param {string} username
   * @returns {Promise<{ authenticated: boolean, profile?: { name: string, id: string }, error?: string }>}
   */
  async checkAuthStatus(username = '') {
    if (!username || username.trim() === '') {
      return { authenticated: false, reason: 'Kein Spielername übergeben' };
    }

    const cleanUser = username.trim();
    try {
      const flow = new Authflow(cleanUser, this.cacheDir, {
        authTitle: this.authTitles,
        deviceType: this.deviceType,
        flow: this.flowType
      });

      const isValid = await flow.msa.verifyTokens().catch(() => false);
      if (!isValid) {
        return { authenticated: false };
      }

      // Falls gültig, versuchen wir das Profil abzurufen
      const tokenData = await flow.getMinecraftJavaToken({ fetchProfile: true }).catch(() => null);
      if (tokenData && tokenData.profile) {
        return {
          authenticated: true,
          profile: {
            name: tokenData.profile.name,
            id: tokenData.profile.id
          }
        };
      }

      return { authenticated: true };
    } catch (err) {
      logger.debug(`[MsaAuthManager] Token-Check für '${cleanUser}' fehlgeschlagen: ${err.message}`);
      return { authenticated: false, error: err.message };
    }
  }

  /**
   * Gibt eine aktuell laufende Authentifizierungs-Sitzung zurück.
   * @param {string} username
   * @returns {Object|null}
   */
  getActiveSession(username = '') {
    if (!username) {
      // Wenn kein Username übergeben wurde, erste aktive Sitzung liefern
      for (const sess of this.activeSessions.values()) {
        if (sess.status === 'pending') return sess;
      }
      return null;
    }
    return this.activeSessions.get(username.trim()) || null;
  }

  /**
   * Startet den Device-Code Auth-Flow.
   * Gibt ein Promise zurück, das resolvt, sobald der Code von Microsoft vorliegt (meist < 2s).
   * Die Authentifizierung läuft im Hintergrund weiter, bis der User im Browser bestätigt.
   *
   * @param {string} username
   * @param {Object} [options]
   * @param {boolean} [options.forceRefresh=false]
   * @returns {Promise<Object>} Session-Informationen inklusive Code und Direct-URL.
   */
  async startAuthFlow(username, options = {}) {
    const cleanUser = (username || 'BaumeisterKI').trim();

    // Vorherige Sitzung für diesen User abbrechen
    if (this.activeSessions.has(cleanUser)) {
      this.cancelAuthFlow(cleanUser);
    }

    let codeReceivedResolve;
    let codeReceivedReject;
    const codeReceivedPromise = new Promise((resolve, reject) => {
      codeReceivedResolve = resolve;
      codeReceivedReject = reject;
    });

    const session = {
      username: cleanUser,
      status: 'starting',
      userCode: null,
      verificationUri: null,
      directUrl: null,
      expiresIn: 900,
      expiresAt: null,
      createdAt: Date.now(),
      cancelled: false
    };

    this.activeSessions.set(cleanUser, session);

    // Code-Callback, wenn prismarine-auth den Microsoft Device Code empfängt
    const onMsaCode = (response) => {
      if (session.cancelled) return;

      session.status = 'pending';
      session.userCode = response.user_code;
      session.verificationUri = response.verification_uri || 'https://www.microsoft.com/link';
      session.directUrl = response.verification_uri
        ? `${response.verification_uri}?otc=${response.user_code}`
        : `https://www.microsoft.com/link?otc=${response.user_code}`;
      session.expiresIn = response.expires_in || 900;
      session.expiresAt = Date.now() + (session.expiresIn * 1000);
      session.message = response.message;

      logger.info(`[MsaAuthManager] Neuer Microsoft-Code für '${cleanUser}': ${session.userCode} (${session.directUrl})`);
      this.emit('code', session);

      if (codeReceivedResolve) {
        codeReceivedResolve(session);
        codeReceivedResolve = null;
      }
    };

    // Flow initialisieren
    const flow = new Authflow(cleanUser, this.cacheDir, {
      authTitle: this.authTitles,
      deviceType: this.deviceType,
      flow: this.flowType,
      forceRefresh: options.forceRefresh || false
    }, onMsaCode);

    // Asynchronen Token-Erwerb starten
    flow.getMinecraftJavaToken({ fetchProfile: true })
      .then((tokenData) => {
        if (session.cancelled) return;

        session.status = 'authenticated';
        session.profile = {
          name: tokenData.profile?.name || cleanUser,
          id: tokenData.profile?.id || null
        };

        logger.info(`[MsaAuthManager] Microsoft-Konto für '${cleanUser}' erfolgreich autorisiert als '${session.profile.name}'!`);
        this.emit('success', session);
      })
      .catch((err) => {
        if (session.cancelled) return;

        session.status = 'error';
        session.error = err.message;
        logger.error(`[MsaAuthManager] Fehler beim Microsoft-Login für '${cleanUser}': ${err.message}`);
        this.emit('error', { username: cleanUser, error: err.message });

        if (codeReceivedReject) {
          codeReceivedReject(err);
          codeReceivedReject = null;
        }
      });

    // Timeout für das Warten auf den Code (15 Sekunden)
    const timeoutTimer = setTimeout(() => {
      if (codeReceivedReject) {
        codeReceivedReject(new Error('Zeitüberschreitung beim Empfangen des Microsoft Device-Codes (Microsoft Server nicht erreichbar).'));
      }
    }, 15000);

    try {
      const codeData = await codeReceivedPromise;
      clearTimeout(timeoutTimer);
      return codeData;
    } catch (err) {
      clearTimeout(timeoutTimer);
      this.activeSessions.delete(cleanUser);
      throw err;
    }
  }

  /**
   * Bricht eine aktive Authentifizierungs-Sitzung ab.
   * @param {string} username
   */
  cancelAuthFlow(username) {
    const cleanUser = (username || '').trim();
    const session = this.activeSessions.get(cleanUser);
    if (session) {
      session.cancelled = true;
      session.status = 'cancelled';
      this.activeSessions.delete(cleanUser);
      this.emit('cancelled', { username: cleanUser });
      logger.info(`[MsaAuthManager] Sitzung für '${cleanUser}' abgebrochen.`);
      return true;
    }
    return false;
  }
}

export const msaAuthManager = new MsaAuthManager();
