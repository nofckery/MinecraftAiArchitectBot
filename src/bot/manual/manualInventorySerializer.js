/**
 * Formats an individual Mineflayer item slot into a clean telemetry/UI DTO.
 * @param {any} item
 * @param {number} slotIndex
 * @returns {object|null}
 */
export function formatInventoryItem(item, slotIndex) {
  if (!item) return null;
  return {
    slot: slotIndex,
    name: item.name,
    displayName: item.displayName || item.name,
    count: item.count,
    type: item.type,
    durabilityUsed: item.durabilityUsed || 0,
    maxDurability: item.maxDurability || 0
  };
}

/**
 * Extracts hotbar information from bot inventory.
 * @param {any} bot
 * @returns {Array<object>}
 */
export function getHotbarInfo(bot) {
  if (!bot || !bot.inventory) return [];
  const selectedSlot = bot.quickBarSlot ?? 0;
  const hotbar = [];
  const slots = bot.inventory.slots || {};

  // Quickbar is in Mineflayer slots 36 to 44
  for (let i = 0; i < 9; i++) {
    const item = slots[36 + i];
    hotbar.push({
      slot: i,
      selected: i === selectedSlot,
      item: item ? {
        name: item.name,
        displayName: item.displayName || item.name,
        count: item.count,
        type: item.type
      } : null
    });
  }
  return hotbar;
}

/**
 * Serializes entire bot player inventory and any active container window.
 * @param {any} bot
 * @returns {object|null}
 */
export function getFullInventory(bot) {
  if (!bot || !bot.inventory) return null;
  const inv = bot.inventory;
  const slots = inv.slots || {};

  // Crafting 2x2: Slot 0 (Result), Slots 1..4 (Inputs)
  const crafting = {
    result: formatInventoryItem(slots[0], 0),
    slots: [
      formatInventoryItem(slots[1], 1),
      formatInventoryItem(slots[2], 2),
      formatInventoryItem(slots[3], 3),
      formatInventoryItem(slots[4], 4)
    ]
  };

  // Armor-Slots: 5: Helmet, 6: Chestplate, 7: Leggings, 8: Boots
  const armor = {
    head: formatInventoryItem(slots[5], 5),
    torso: formatInventoryItem(slots[6], 6),
    legs: formatInventoryItem(slots[7], 7),
    feet: formatInventoryItem(slots[8], 8)
  };

  // Off-hand: Slot 45
  const offhand = formatInventoryItem(slots[45], 45);

  // Main inventory: Slots 9..35 (3 rows of 9 slots = 27 slots)
  const main = [];
  for (let i = 9; i <= 35; i++) {
    main.push(formatInventoryItem(slots[i], i));
  }

  // Hotbar: Slots 36..44 (9 slots)
  const hotbar = [];
  for (let i = 36; i <= 44; i++) {
    hotbar.push(formatInventoryItem(slots[i], i));
  }

  // Floating item held by cursor
  const selectedItem = inv.selectedItem ? formatInventoryItem(inv.selectedItem, -1) : null;

  // Active open container window (chest, furnace, workbench, etc.)
  let container = null;
  const curWin = bot.currentWindow;
  if (curWin && curWin.id !== 0) {
    const containerSlots = [];
    const end = curWin.inventoryStart || 0;
    for (let i = 0; i < end; i++) {
      containerSlots.push(formatInventoryItem(curWin.slots[i], i));
    }
    container = {
      id: curWin.id,
      type: curWin.type,
      title: curWin.title || 'Container',
      slots: containerSlots,
      inventoryStart: curWin.inventoryStart || 0
    };
  }

  return {
    crafting,
    armor,
    offhand,
    main,
    hotbar,
    selectedItem,
    container,
    quickBarSlot: bot.quickBarSlot ?? 0
  };
}
