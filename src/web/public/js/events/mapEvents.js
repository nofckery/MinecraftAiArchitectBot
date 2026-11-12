/**
 * 2D Topographic Area Map Event Handlers & State
 * Decoupled UI Subsystem for Architect Mission Control.
 */

import { drawAreaMap, findCellAt } from '../areaMap.js';
import { sendWS } from '../wsClient.js';
import { showDashboardToast } from '../ui/telemetryBar.js';

let areaMapData = null;
let mapSelection = null;
let mapIsDragging = false;
let buildBoxFacing = 'north';
let isMapMoveMode = false;
let activeWaypoint = null;

export function getAreaMapData() {
  return areaMapData;
}

export function setAreaMapData(data) {
  areaMapData = data;
}

export function getMapSelection() {
  return mapSelection;
}

export function getBuildBoxFacing() {
  return buildBoxFacing;
}

export function setBuildBoxFacing(facing) {
  buildBoxFacing = facing;
}

export function getActiveWaypoint() {
  return activeWaypoint;
}

export function clearActiveWaypoint() {
  activeWaypoint = null;
  renderAreaMap();
}

export function renderAreaMap() {
  if (typeof document === 'undefined') return;
  const canvas = document.getElementById('areaMapCanvas');
  if (!canvas || !areaMapData) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  drawAreaMap(canvas, ctx, areaMapData, mapSelection, buildBoxFacing, activeWaypoint);
}

export function setupMapEvents() {
  const areaMapCanvas = document.getElementById('areaMapCanvas');
  const mapTooltip = document.getElementById('mapTooltip');
  const btnRefreshMap = document.getElementById('btnRefreshMap');
  const btnApplyBuildBox = document.getElementById('btnApplyBuildBox');
  const btnToggleMapMoveMode = document.getElementById('btnToggleMapMoveMode');
  const selectionDimensions = document.getElementById('selectionDimensions');
  const facingBtns = document.querySelectorAll('.btn-facing');

  // Move-Mode Toggle button
  if (btnToggleMapMoveMode) {
    btnToggleMapMoveMode.onclick = () => {
      isMapMoveMode = !isMapMoveMode;
      btnToggleMapMoveMode.classList.toggle('active', isMapMoveMode);
      if (isMapMoveMode) {
        showDashboardToast('🎯 Klick-Navigation aktiv: Klicke auf die Karte, um den Bot zu bewegen', 'info');
      } else {
        showDashboardToast('Bauplatz-Markierungsmodus aktiv', 'info');
      }
    };
  }

  // Facing buttons
  facingBtns.forEach(btn => {
    btn.onclick = () => {
      facingBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      buildBoxFacing = btn.dataset.facing;
      if (mapSelection) {
        const minCol = Math.min(mapSelection.x1, mapSelection.x2);
        const maxCol = Math.max(mapSelection.x1, mapSelection.x2);
        const minRow = Math.min(mapSelection.z1, mapSelection.z2);
        const maxRow = Math.max(mapSelection.z1, mapSelection.z2);
        const w = maxCol - minCol + 1;
        const d = maxRow - minRow + 1;
        if (selectionDimensions) selectionDimensions.textContent = `${w}x${d} Blöcke (${buildBoxFacing})`;
        if (btnApplyBuildBox) btnApplyBuildBox.disabled = false;
      }
      renderAreaMap();
    };
  });

  if (!areaMapCanvas) return;

  areaMapCanvas.onmousedown = (e) => {
    const rect = areaMapCanvas.getBoundingClientRect();
    const col = Math.max(0, Math.min(63, Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * 64)));
    const row = Math.max(0, Math.min(63, Math.floor(((e.clientY - rect.top) / Math.max(1, rect.height)) * 64)));

    if (e.shiftKey || isMapMoveMode) {
      // Shift + Click or Click-Move-Mode: navigate bot directly
      if (areaMapData) {
        const targetX = areaMapData.center.x - 32 + col;
        const targetZ = areaMapData.center.z - 32 + row;
        const cell = findCellAt(areaMapData, targetX, targetZ);
        const targetY = (cell && typeof cell.y === 'number') ? (cell.y + 1) : (areaMapData.center?.y ?? 64);

        activeWaypoint = { col, row, x: targetX, y: targetY, z: targetZ };

        sendWS({
          type: 'control_action',
          action: 'move_to',
          targetPos: { x: targetX, y: targetY, z: targetZ }
        });
        showDashboardToast(`🚶 Bot navigiert zu (${targetX}, ${targetY}, ${targetZ})...`, 'command');
        renderAreaMap();
      }
      return;
    }

    mapIsDragging = true;
    mapSelection = { x1: col, z1: row, x2: col, z2: row };
    if (selectionDimensions) selectionDimensions.textContent = '1x1 Blöcke markiert';
    if (btnApplyBuildBox) btnApplyBuildBox.disabled = false;
    renderAreaMap();
  };

  areaMapCanvas.onmousemove = (e) => {
    const rect = areaMapCanvas.getBoundingClientRect();
    const col = Math.max(0, Math.min(63, Math.floor(((e.clientX - rect.left) / Math.max(1, rect.width)) * 64)));
    const row = Math.max(0, Math.min(63, Math.floor(((e.clientY - rect.top) / Math.max(1, rect.height)) * 64)));

    if (areaMapData && mapTooltip) {
      const worldX = areaMapData.center.x - 32 + col;
      const worldZ = areaMapData.center.z - 32 + row;
      const cell = findCellAt(areaMapData, worldX, worldZ);

      if (cell) {
        const wrapperRect = areaMapCanvas.parentElement ? areaMapCanvas.parentElement.getBoundingClientRect() : rect;
        let tipX = e.clientX - wrapperRect.left + 12;
        let tipY = e.clientY - wrapperRect.top + 12;
        if (tipX + 130 > wrapperRect.width) tipX = e.clientX - wrapperRect.left - 135;
        if (tipY + 45 > wrapperRect.height) tipY = e.clientY - wrapperRect.top - 45;
        mapTooltip.innerHTML = `<strong>${cell.blockName || 'unbekannt'}</strong><br>X: ${cell.x}, Y: ${cell.y}, Z: ${cell.z}`;
        mapTooltip.style.left = `${Math.max(4, Math.min(Math.max(4, wrapperRect.width - 130), tipX))}px`;
        mapTooltip.style.top = `${Math.max(4, Math.min(Math.max(4, wrapperRect.height - 45), tipY))}px`;
        mapTooltip.style.display = 'block';
      } else {
        mapTooltip.style.display = 'none';
      }
    }

    if (!mapIsDragging || !mapSelection) return;

    mapSelection.x2 = col;
    mapSelection.z2 = row;
    const w = Math.abs(mapSelection.x2 - mapSelection.x1) + 1;
    const d = Math.abs(mapSelection.z2 - mapSelection.z1) + 1;
    if (selectionDimensions) selectionDimensions.textContent = `${w}x${d} Blöcke markiert`;
    if (btnApplyBuildBox) btnApplyBuildBox.disabled = false;
    renderAreaMap();
  };

  areaMapCanvas.onmouseleave = () => {
    if (mapTooltip) mapTooltip.style.display = 'none';
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('mouseup', () => {
      if (mapIsDragging) mapIsDragging = false;
    });
  }

  if (btnApplyBuildBox) {
    btnApplyBuildBox.onclick = () => {
      if (!mapSelection || !areaMapData) return;
      const minCol = Math.min(mapSelection.x1, mapSelection.x2);
      const maxCol = Math.max(mapSelection.x1, mapSelection.x2);
      const minRow = Math.min(mapSelection.z1, mapSelection.z2);
      const maxRow = Math.max(mapSelection.z1, mapSelection.z2);

      const minX = areaMapData.center.x - 32 + minCol;
      const maxX = areaMapData.center.x - 32 + maxCol;
      const minZ = areaMapData.center.z - 32 + minRow;
      const maxZ = areaMapData.center.z - 32 + maxRow;

      let baseY = areaMapData.center.y;
      if (areaMapData.grid) {
        const selectedCells = areaMapData.grid.filter(c => c.x >= minX && c.x <= maxX && c.z >= minZ && c.z <= maxZ && typeof c.y === 'number');
        if (selectedCells.length > 0) {
          baseY = Math.min(...selectedCells.map(c => c.y));
        }
      }

      sendWS({
        type: 'set_build_box',
        minX, minZ, maxX, maxZ,
        baseY,
        facing: buildBoxFacing
      });

      if (selectionDimensions) selectionDimensions.textContent = `Fixiert: ${maxCol - minCol + 1}x${maxRow - minRow + 1} (${buildBoxFacing})`;
      btnApplyBuildBox.disabled = true;
    };
  }

  if (btnRefreshMap) {
    btnRefreshMap.onclick = () => sendWS({ type: 'request_area_map' });
  }
}
