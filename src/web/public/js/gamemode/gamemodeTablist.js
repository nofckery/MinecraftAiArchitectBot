/**
 * Minecraft Player List (Tablist) Overlay in Gamemode
 */

import { gamemodeCtx } from './gamemodeContext.js';

/**
 * Authentic 8x8 pixel Steve avatar data URI used as instant offline fallback.
 */
export const STEVE_AVATAR = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 8 8' width='16' height='16'><rect width='8' height='2' fill='%23492c19'/><rect y='2' width='8' height='6' fill='%23c68b59'/><rect x='0' y='2' width='1' height='2' fill='%23492c19'/><rect x='7' y='2' width='1' height='2' fill='%23492c19'/><rect x='1' y='3' width='1' height='1' fill='%23ffffff'/><rect x='2' y='3' width='1' height='1' fill='%232e3d99'/><rect x='5' y='3' width='1' height='1' fill='%232e3d99'/><rect x='6' y='3' width='1' height='1' fill='%23ffffff'/><rect x='3' y='4' width='2' height='1' fill='%238e573a'/><rect x='2' y='5' width='4' height='1' fill='%23492c19'/></svg>";

export function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Returns HTML for Minecraft Java Edition's 5-bar latency indicator.
 * @param {number} ping
 * @returns {string}
 */
export function getPingBarsHtml(ping) {
  const p = typeof ping === 'number' ? ping : 0;
  let colorClass = 'active-green';
  let activeBars = 5;

  if (p < 0) {
    activeBars = 0;
  } else if (p < 150) {
    colorClass = 'active-green';
    activeBars = 5;
  } else if (p < 300) {
    colorClass = 'active-green';
    activeBars = 4;
  } else if (p < 600) {
    colorClass = 'active-yellow';
    activeBars = 3;
  } else if (p < 1000) {
    colorClass = 'active-orange';
    activeBars = 2;
  } else {
    colorClass = 'active-red';
    activeBars = 1;
  }

  let barsHtml = '';
  for (let i = 1; i <= 5; i++) {
    const isActive = i <= activeBars;
    const barClass = isActive ? colorClass : 'inactive';
    barsHtml += `<span class="mc-ping-bar bar-${i} ${barClass}"></span>`;
  }

  return `<div class="mc-tablist-ping" title="Latenz: ${p} ms">${barsHtml}</div>`;
}

/**
 * Renders the player tablist with header, footer, player heads and ping bars.
 * @param {Array<object>} [players=gamemodeCtx.lastPlayersList]
 * @param {object} [tablistData=gamemodeCtx.lastTablistData]
 */
export function renderTabList(players = gamemodeCtx.lastPlayersList, tablistData = gamemodeCtx.lastTablistData) {
  const elements = gamemodeCtx.elements;
  const tablistEl = elements.gamemodePlayerTablist || (typeof document !== 'undefined' ? document.getElementById('gamemodePlayerTablist') : null);
  if (!tablistEl) return;

  const playerArr = Array.isArray(players) ? players : [];

  // Update online count
  const countEl = elements.mcTablistPlayerCount || (typeof document !== 'undefined' ? document.getElementById('mcTablistPlayerCount') : null);
  if (countEl) {
    countEl.textContent = `(${playerArr.length})`;
  }

  // Update Header
  const headerEl = elements.mcTablistHeader || (typeof document !== 'undefined' ? document.getElementById('mcTablistHeader') : null);
  if (headerEl) {
    if (tablistData?.header) {
      headerEl.textContent = tablistData.header;
      headerEl.classList.remove('hidden');
    } else {
      headerEl.textContent = '';
      headerEl.classList.add('hidden');
    }
  }

  // Update Footer
  const footerEl = elements.mcTablistFooter || (typeof document !== 'undefined' ? document.getElementById('mcTablistFooter') : null);
  if (footerEl) {
    if (tablistData?.footer) {
      footerEl.textContent = tablistData.footer;
      footerEl.classList.remove('hidden');
    } else {
      footerEl.textContent = '';
      footerEl.classList.add('hidden');
    }
  }

  // Update Player Grid
  const gridEl = elements.mcTablistPlayerGrid || (typeof document !== 'undefined' ? document.getElementById('mcTablistPlayerGrid') : null);
  if (gridEl) {
    if (playerArr.length === 0) {
      gridEl.innerHTML = `
        <div class="mc-tablist-empty">
          <span>Keine weiteren Spieler online</span>
        </div>
      `;
      gridEl.style.gridTemplateRows = '24px';
      return;
    }

    const count = playerArr.length;
    const maxPerCol = 20;
    const cols = Math.min(4, Math.max(1, Math.ceil(count / maxPerCol)));
    const rows = Math.ceil(count / cols);
    gridEl.style.gridTemplateRows = `repeat(${rows}, 24px)`;

    let html = '';
    for (const p of playerArr) {
      const username = p.username || 'Unbekannt';
      const displayName = p.displayName || username;
      const isSpectator = p.gamemode === 3;
      const isBot = Boolean(p.isBot);
      const pingBars = getPingBarsHtml(p.ping);
      const avatarSrc = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/16`;

      html += `
        <div class="mc-tablist-player-row ${isBot ? 'is-bot' : ''}" data-player="${escapeHtml(username)}">
          <img class="mc-tablist-head" src="${avatarSrc}" onerror="this.onerror=null;this.src='${STEVE_AVATAR}';" alt="${escapeHtml(username)}" width="16" height="16">
          <span class="mc-tablist-name ${isSpectator ? 'is-spectator' : ''} ${isBot ? 'is-bot-name' : ''}" title="${escapeHtml(username)}">
            ${escapeHtml(displayName)}${isBot ? ' (Bot)' : ''}
          </span>
          ${pingBars}
        </div>
      `;
    }
    gridEl.innerHTML = html;
  }
}

/**
 * Display the Minecraft Player Tablist.
 */
export function showTabList() {
  if (!gamemodeCtx.isGamemodeActive || gamemodeCtx.isTabListVisible) return;
  gamemodeCtx.isTabListVisible = true;
  const tablistEl = gamemodeCtx.elements.gamemodePlayerTablist || (typeof document !== 'undefined' ? document.getElementById('gamemodePlayerTablist') : null);
  if (tablistEl) {
    tablistEl.classList.remove('hidden');
  }
  renderTabList(gamemodeCtx.lastPlayersList, gamemodeCtx.lastTablistData);
}

/**
 * Hide the Minecraft Player Tablist.
 */
export function hideTabList() {
  if (!gamemodeCtx.isTabListVisible) return;
  gamemodeCtx.isTabListVisible = false;
  const tablistEl = gamemodeCtx.elements.gamemodePlayerTablist || (typeof document !== 'undefined' ? document.getElementById('gamemodePlayerTablist') : null);
  if (tablistEl) {
    tablistEl.classList.add('hidden');
  }
}

/**
 * Return whether the Player Tablist is currently open.
 * @returns {boolean}
 */
export function isTabListOpen() {
  return gamemodeCtx.isTabListVisible;
}

/**
 * Get the cached player list.
 * @returns {Array<object>}
 */
export function getPlayersList() {
  return gamemodeCtx.lastPlayersList;
}
