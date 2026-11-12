/**
 * In-Game Minecraft Chat HUD (T & Slash) with History & Server Messaging.
 */

import { sendWS } from '../wsClient.js';
import { gamemodeCtx } from './gamemodeContext.js';

let requestPointerLockFn = () => {};
let clearAllControlsFn = () => {};
let closeInventoryFn = () => {};
let closePauseMenuFn = () => {};

export function setChatDependencies(deps) {
  if (deps.requestPointerLock) requestPointerLockFn = deps.requestPointerLock;
  if (deps.clearAllControls) clearAllControlsFn = deps.clearAllControls;
  if (deps.closeInventory) closeInventoryFn = deps.closeInventory;
  if (deps.closePauseMenu) closePauseMenuFn = deps.closePauseMenu;
}

export function openChat(prefill = '') {
  if (!gamemodeCtx.isGamemodeActive) return;
  if (gamemodeCtx.isInventoryOpen) closeInventoryFn();
  if (gamemodeCtx.isPauseMenuOpen) closePauseMenuFn();

  gamemodeCtx.isChatOpen = true;
  const elements = gamemodeCtx.elements;
  if (elements.gamemodeChatInputContainer) {
    elements.gamemodeChatInputContainer.classList.remove('hidden');
  }
  if (elements.gamemodeChatInput) {
    elements.gamemodeChatInput.value = prefill;
    elements.gamemodeChatInput.focus();
  }
  // Exit pointer lock so user can type freely
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
  clearAllControlsFn('chat_opened');
}

export function closeChat() {
  gamemodeCtx.isChatOpen = false;
  gamemodeCtx.chatHistoryIndex = -1;
  const elements = gamemodeCtx.elements;
  if (elements.gamemodeChatInputContainer) {
    elements.gamemodeChatInputContainer.classList.add('hidden');
  }
  if (elements.gamemodeChatInput) {
    elements.gamemodeChatInput.value = '';
    elements.gamemodeChatInput.blur();
  }
  if (gamemodeCtx.isGamemodeActive && !gamemodeCtx.isInventoryOpen && !gamemodeCtx.isPauseMenuOpen) {
    requestPointerLockFn();
  }
}

export function sendChatMessage(text) {
  const clean = (text || '').trim();
  if (clean) {
    sendWS({
      type: 'send_chat',
      message: clean
    });
    gamemodeCtx.chatHistory.push(clean);
    if (gamemodeCtx.chatHistory.length > 50) gamemodeCtx.chatHistory.shift();
  }
  closeChat();
}

export function navigateChatHistory(direction) {
  const history = gamemodeCtx.chatHistory;
  if (!history.length) return;
  gamemodeCtx.chatHistoryIndex += direction;
  if (gamemodeCtx.chatHistoryIndex < 0) gamemodeCtx.chatHistoryIndex = 0;
  if (gamemodeCtx.chatHistoryIndex >= history.length) {
    gamemodeCtx.chatHistoryIndex = history.length;
    if (gamemodeCtx.elements.gamemodeChatInput) gamemodeCtx.elements.gamemodeChatInput.value = '';
    return;
  }
  const item = history[gamemodeCtx.chatHistoryIndex];
  if (gamemodeCtx.elements.gamemodeChatInput && item) {
    gamemodeCtx.elements.gamemodeChatInput.value = item;
  }
}

export function handleIncomingChat(msg) {
  const elements = gamemodeCtx.elements;
  if (!msg || !elements.gamemodeChatLog) return;
  const sender = msg.sender || 'Server';
  const text = msg.message || '';

  const lineEl = document.createElement('div');
  lineEl.className = 'gamemode-chat-line';

  const senderEl = document.createElement('span');
  senderEl.className = 'chat-sender';
  senderEl.textContent = `<${sender}> `;

  const textEl = document.createElement('span');
  textEl.className = 'chat-text';
  textEl.textContent = text;

  lineEl.appendChild(senderEl);
  lineEl.appendChild(textEl);
  elements.gamemodeChatLog.appendChild(lineEl);
  elements.gamemodeChatLog.scrollTop = elements.gamemodeChatLog.scrollHeight;

  // Auto-fade chat message after 8 seconds
  setTimeout(() => {
    if (!gamemodeCtx.isChatOpen) {
      lineEl.classList.add('fading');
      setTimeout(() => lineEl.remove(), 1000);
    }
  }, 8000);
}
