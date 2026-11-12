/**
 * Full Minecraft Player & Container Inventory GUI (E) with Click, Shift-Click & Drop Support.
 */

import { sendWS } from '../wsClient.js';
import { gamemodeCtx } from './gamemodeContext.js';
import { getItemIcon } from './itemIcons.js';
import { renderPlayerDoll } from './gamemodeDoll.js';

let requestPointerLockFn = () => {};
let clearAllControlsFn = () => {};
let closeChatFn = () => {};
let closePauseMenuFn = () => {};
let renderHotbarFn = () => {};

export function setInventoryDependencies(deps) {
  if (deps.requestPointerLock) requestPointerLockFn = deps.requestPointerLock;
  if (deps.clearAllControls) clearAllControlsFn = deps.clearAllControls;
  if (deps.closeChat) closeChatFn = deps.closeChat;
  if (deps.closePauseMenu) closePauseMenuFn = deps.closePauseMenu;
  if (deps.renderHotbar) renderHotbarFn = deps.renderHotbar;
}

export function openInventory() {
  if (gamemodeCtx.isChatOpen) closeChatFn();
  if (gamemodeCtx.isPauseMenuOpen) closePauseMenuFn();

  gamemodeCtx.isInventoryOpen = true;
  const elements = gamemodeCtx.elements;
  if (elements.gamemodeInventoryModal) {
    elements.gamemodeInventoryModal.classList.remove('hidden');
  }
  if (typeof document !== 'undefined' && document.pointerLockElement) {
    try { document.exitPointerLock(); } catch {}
  }
  clearAllControlsFn('inventory_opened');

  // Request fresh inventory from server
  sendWS({ type: 'get_inventory' });

  if (gamemodeCtx.lastFullInventory) {
    renderFullInventory(gamemodeCtx.lastFullInventory);
  }
}

export function closeInventory() {
  gamemodeCtx.isInventoryOpen = false;
  gamemodeCtx.hoveredSlotIndex = null;
  const elements = gamemodeCtx.elements;
  if (elements.gamemodeInventoryModal) {
    elements.gamemodeInventoryModal.classList.add('hidden');
  }
  if (elements.inventoryItemTooltip) {
    elements.inventoryItemTooltip.classList.add('hidden');
  }
  if (elements.gamemodeHeldItemCursor) {
    elements.gamemodeHeldItemCursor.classList.add('hidden');
  }

  // Notify server to close any active container window
  sendWS({ type: 'close_window' });

  if (gamemodeCtx.isGamemodeActive && !gamemodeCtx.isChatOpen && !gamemodeCtx.isPauseMenuOpen) {
    requestPointerLockFn();
  }
}

export function toggleInventory() {
  if (gamemodeCtx.isInventoryOpen) {
    closeInventory();
  } else {
    openInventory();
  }
}

/**
 * Asynchronously load item textures map from pre-generated JSON or API.
 */
export async function loadItemTextures() {
  if (typeof fetch === 'undefined') return;
  if (Object.keys(gamemodeCtx.itemTexturesMap).length > 0 || gamemodeCtx.texturesLoading) return;
  gamemodeCtx.texturesLoading = true;
  try {
    const res = await fetch('/img/mc/item_textures.json');
    if (res && res.ok) {
      gamemodeCtx.itemTexturesMap = await res.json();
      if (gamemodeCtx.isInventoryOpen && gamemodeCtx.lastFullInventory) {
        renderFullInventory(gamemodeCtx.lastFullInventory);
      }
      if (gamemodeCtx.lastHotbarData && gamemodeCtx.lastHotbarData.length > 0) {
        renderHotbarFn(gamemodeCtx.lastHotbarData, gamemodeCtx.currentSelectedSlot);
      }
    }
  } catch (err) {
    console.warn('[ManualCockpit] Could not load item textures:', err);
  } finally {
    gamemodeCtx.texturesLoading = false;
  }
}

/**
 * Get texture URL for a given Minecraft item or block name.
 * @param {string} name
 * @returns {string|null}
 */
export function getItemTextureUrl(name) {
  if (!name) return null;
  const clean = String(name).toLowerCase().trim().replace(/^minecraft:/, '');
  if (gamemodeCtx.itemTexturesMap && gamemodeCtx.itemTexturesMap[clean]) {
    return gamemodeCtx.itemTexturesMap[clean];
  }
  return `/textures/1.20.1/item/${clean}.png`;
}

export function handleInventorySlotClick(slotIndex, e) {
  if (typeof slotIndex !== 'number') return;
  e.preventDefault();
  e.stopPropagation();

  // Mode: 0 = normal click, 1 = shift click, 4 = drop
  let mode = 0;
  let button = e.button === 2 ? 1 : 0; // 0 = left, 1 = right

  if (e.shiftKey) {
    mode = 1;
    button = 0;
  }

  sendWS({
    type: 'inventory_click',
    slot: slotIndex,
    button,
    mode
  });
}

export function showSlotTooltip(targetEl, slotIndex) {
  const elements = gamemodeCtx.elements;
  if (!elements.inventoryItemTooltip || !targetEl) return;
  const item = targetEl._itemData;
  if (!item || !item.name) {
    elements.inventoryItemTooltip.classList.add('hidden');
    return;
  }

  const name = item.displayName || item.name.replace(/_/g, ' ');
  let html = `<div class="tooltip-title">${name}</div>`;
  if (item.count > 1) {
    html += `<div class="tooltip-meta">Anzahl: ${item.count}</div>`;
  }
  if (item.maxDurability > 0) {
    const remaining = Math.max(0, item.maxDurability - (item.durabilityUsed || 0));
    html += `<div class="tooltip-durability">Haltbarkeit: ${remaining} / ${item.maxDurability}</div>`;
  }

  elements.inventoryItemTooltip.innerHTML = html;
  elements.inventoryItemTooltip.classList.remove('hidden');
}

export function hideSlotTooltip() {
  const elements = gamemodeCtx.elements;
  if (elements.inventoryItemTooltip) {
    elements.inventoryItemTooltip.classList.add('hidden');
  }
}

/**
 * Render slot content with authentic Minecraft textures, count labels, durability bars, and ghost icons.
 */
export function renderItemSlotContent(el, item, ghostIconUrl = null) {
  if (!el) return;
  el._itemData = item;

  // Mock test fallback where document.createElement might not be present
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    if (item && item.name) {
      el.innerHTML = `<span class="slot-icon">${getItemIcon(item.name)}</span><span class="slot-count">${item.count > 1 ? item.count : ''}</span>`;
      if (el.classList && el.classList.add) el.classList.add('has-item');
    } else {
      el.innerHTML = `<span class="slot-icon"></span><span class="slot-count"></span>`;
      if (el.classList && el.classList.remove) el.classList.remove('has-item');
    }
    return;
  }

  el.innerHTML = '';

  if (item && item.name) {
    el.classList.add('has-item');

    // 1. Pixelated Item Texture Image
    const img = document.createElement('img');
    img.className = 'mc-item-icon slot-icon';
    img.alt = item.displayName || item.name;
    const texUrl = getItemTextureUrl(item.name);
    if (texUrl) {
      img.src = texUrl;
      img.onerror = () => {
        img.style.display = 'none';
        if (!el.querySelector('.slot-icon-fallback')) {
          const fb = document.createElement('span');
          fb.className = 'slot-icon-fallback slot-icon';
          fb.textContent = getItemIcon(item.name);
          el.insertBefore(fb, el.firstChild);
        }
      };
    } else {
      img.style.display = 'none';
      const fb = document.createElement('span');
      fb.className = 'slot-icon-fallback slot-icon';
      fb.textContent = getItemIcon(item.name);
      el.appendChild(fb);
    }
    el.appendChild(img);

    // 2. Stack count label with Minecraft font
    if (item.count > 1) {
      const countEl = document.createElement('span');
      countEl.className = 'mc-item-count slot-count';
      countEl.textContent = String(item.count);
      el.appendChild(countEl);
    }

    // 3. Durability Bar
    if (item.maxDurability > 0 && item.durabilityUsed > 0) {
      const remaining = Math.max(0, item.maxDurability - item.durabilityUsed);
      const pct = Math.max(0, Math.min(100, Math.round((remaining / item.maxDurability) * 100)));
      const durBar = document.createElement('div');
      durBar.className = 'mc-durability-bar';
      const color = pct > 50 ? '#55ff55' : (pct > 20 ? '#ffff55' : '#ff5555');
      durBar.innerHTML = `<div class="mc-durability-fill" style="width:${pct}%;background:${color}"></div>`;
      el.appendChild(durBar);
    }
  } else {
    el.classList.remove('has-item');
    if (ghostIconUrl) {
      const ghost = document.createElement('img');
      ghost.className = 'slot-ghost-icon';
      ghost.src = ghostIconUrl;
      ghost.alt = '';
      el.appendChild(ghost);
    }
  }
}

export function renderFullInventory(inv) {
  if (!inv) return;
  const elements = gamemodeCtx.elements;

  // 1. Container Window vs Player Inventory Window
  const isContainerOpen = inv.container && Array.isArray(inv.container.slots) && inv.container.slots.length > 0;

  if (isContainerOpen) {
    if (elements.mcPlayerInventoryWindow) elements.mcPlayerInventoryWindow.classList.add('hidden');
    if (elements.inventoryContainerSection) {
      elements.inventoryContainerSection.classList.remove('hidden');
      const numSlots = inv.container.slots.length;
      if (numSlots > 27) {
        elements.inventoryContainerSection.classList.add('double-chest');
        elements.inventoryContainerSection.classList.remove('single-chest');
      } else {
        elements.inventoryContainerSection.classList.add('single-chest');
        elements.inventoryContainerSection.classList.remove('double-chest');
      }

      if (elements.invContainerTitle) {
        elements.invContainerTitle.textContent = inv.container.title || 'Behälter';
      }

      if (elements.invContainerGrid) {
        elements.invContainerGrid.innerHTML = '';
        inv.container.slots.forEach((item, idx) => {
          const slotEl = createInventorySlotElement(idx, item);
          elements.invContainerGrid.appendChild(slotEl);
        });
      }

      // Container Player Main Grid (inventoryStart .. inventoryStart + 26)
      const invStart = inv.container.inventoryStart !== undefined ? inv.container.inventoryStart : numSlots;
      if (elements.invContainerPlayerMainGrid) {
        elements.invContainerPlayerMainGrid.innerHTML = '';
        const mainItems = Array.isArray(inv.main) ? inv.main : [];
        for (let i = 0; i < 27; i++) {
          const slotIdx = invStart + i;
          const item = mainItems[i] || null;
          const slotEl = createInventorySlotElement(slotIdx, item);
          elements.invContainerPlayerMainGrid.appendChild(slotEl);
        }
      }

      // Container Player Hotbar Grid (inventoryStart + 27 .. inventoryStart + 35)
      if (elements.invContainerPlayerHotbarGrid) {
        elements.invContainerPlayerHotbarGrid.innerHTML = '';
        const hotbarItems = Array.isArray(inv.hotbar) ? inv.hotbar : [];
        for (let i = 0; i < 9; i++) {
          const slotIdx = invStart + 27 + i;
          const item = hotbarItems[i] || null;
          const slotEl = createInventorySlotElement(slotIdx, item);
          if (i === gamemodeCtx.currentSelectedSlot) slotEl.classList.add('active');
          elements.invContainerPlayerHotbarGrid.appendChild(slotEl);
        }
      }
    }
  } else {
    // Normal Player Inventory Window
    if (elements.inventoryContainerSection) elements.inventoryContainerSection.classList.add('hidden');
    if (elements.mcPlayerInventoryWindow) elements.mcPlayerInventoryWindow.classList.remove('hidden');

    // Crafting Output (Slot 0)
    const slot0El = elements.invSlot0 || document.getElementById('invSlot0');
    if (slot0El) {
      renderItemSlotContent(slot0El, inv.craftResult || null, null);
    }

    // 2x2 Crafting Grid (Slots 1, 2, 3, 4)
    const craftingItems = Array.isArray(inv.crafting) ? inv.crafting : [];
    [1, 2, 3, 4].forEach(slotId => {
      const craftEl = document.getElementById(`invSlot${slotId}`);
      if (craftEl) {
        renderItemSlotContent(craftEl, craftingItems[slotId - 1] || null, null);
      }
    });

    // Armor Slots (5, 6, 7, 8) & Offhand (45)
    const armorDefs = [
      { id: 'invSlot5', item: inv.armor?.head, ghost: '/img/mc/empty_armor_slot_helmet.png' },
      { id: 'invSlot6', item: inv.armor?.torso, ghost: '/img/mc/empty_armor_slot_chestplate.png' },
      { id: 'invSlot7', item: inv.armor?.legs, ghost: '/img/mc/empty_armor_slot_leggings.png' },
      { id: 'invSlot8', item: inv.armor?.feet, ghost: '/img/mc/empty_armor_slot_boots.png' },
      { id: 'invSlot45', item: inv.offhand, ghost: '/img/mc/empty_armor_slot_shield.png' }
    ];
    armorDefs.forEach(({ id, item, ghost }) => {
      const el = document.getElementById(id);
      if (el) {
        renderItemSlotContent(el, item, ghost);
      }
    });

    // Steve doll canvas
    renderPlayerDoll(inv);

    // Main Inventory (Slots 9..35 = 27 slots)
    if (elements.invMainGrid) {
      elements.invMainGrid.innerHTML = '';
      const mainItems = Array.isArray(inv.main) ? inv.main : [];
      for (let i = 0; i < 27; i++) {
        const slotIndex = 9 + i;
        const item = mainItems[i] || null;
        const slotEl = createInventorySlotElement(slotIndex, item);
        elements.invMainGrid.appendChild(slotEl);
      }
    }

    // Hotbar Grid (Slots 36..44 = 9 slots)
    if (elements.invHotbarGrid) {
      elements.invHotbarGrid.innerHTML = '';
      const hotbarItems = Array.isArray(inv.hotbar) ? inv.hotbar : [];
      for (let i = 0; i < 9; i++) {
        const slotIndex = 36 + i;
        const item = hotbarItems[i] || null;
        const slotEl = createInventorySlotElement(slotIndex, item);
        if (i === gamemodeCtx.currentSelectedSlot) slotEl.classList.add('active');
        elements.invHotbarGrid.appendChild(slotEl);
      }
    }
  }

  // Floating Held Item on cursor
  if (elements.gamemodeHeldItemCursor) {
    if (inv.selectedItem && inv.selectedItem.name) {
      elements.gamemodeHeldItemCursor.classList.remove('hidden');
      const icon = elements.gamemodeHeldItemCursor.querySelector('.held-icon');
      const count = elements.gamemodeHeldItemCursor.querySelector('.held-count');
      const texUrl = getItemTextureUrl(inv.selectedItem.name);

      if (icon) {
        if (texUrl && typeof document !== 'undefined' && typeof document.createElement === 'function') {
          icon.innerHTML = `<img src="${texUrl}" class="mc-item-icon" alt="" style="width:32px;height:32px;image-rendering:pixelated">`;
        } else {
          icon.textContent = getItemIcon(inv.selectedItem.name);
        }
      }
      if (count) {
        count.textContent = inv.selectedItem.count > 1 ? String(inv.selectedItem.count) : '';
      }
    } else {
      elements.gamemodeHeldItemCursor.classList.add('hidden');
    }
  }
}

export function createInventorySlotElement(slotIndex, item) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return {
      classList: { add: () => {}, remove: () => {}, contains: () => false },
      dataset: { slot: String(slotIndex) },
      _itemData: item,
      innerHTML: ''
    };
  }

  const el = document.createElement('div');
  el.className = 'mc-slot inv-slot';
  el.dataset.slot = String(slotIndex);
  renderItemSlotContent(el, item, null);

  el.onclick = (e) => handleInventorySlotClick(slotIndex, e);
  el.oncontextmenu = (e) => handleInventorySlotClick(slotIndex, e);
  el.onmouseenter = () => {
    gamemodeCtx.hoveredSlotIndex = slotIndex;
    showSlotTooltip(el, slotIndex);
  };
  el.onmouseleave = () => {
    if (gamemodeCtx.hoveredSlotIndex === slotIndex) gamemodeCtx.hoveredSlotIndex = null;
    hideSlotTooltip();
  };

  return el;
}
