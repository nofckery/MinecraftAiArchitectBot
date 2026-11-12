/**
 * V3 Fine-Grained Role Matrix and Routing Profile Selector.
 */

import { modelCtx } from './modelContext.js';
import { setRoutingProfile, pinRole } from './modelApiClient.js';

export function renderProfileSelector() {
  const btnEco = document.getElementById('btnProfileEco');
  const btnBal = document.getElementById('btnProfileBalanced');
  const btnQual = document.getElementById('btnProfileQuality');

  const updateBtn = (btn, prof) => {
    if (!btn) return;
    btn.classList.toggle('active', modelCtx.activeProfile === prof);
    if (!btn._hasListener) {
      btn._hasListener = true;
      btn.addEventListener('click', () => setRoutingProfile(prof));
    }
  };

  updateBtn(btnEco, 'eco');
  updateBtn(btnBal, 'balanced');
  updateBtn(btnQual, 'quality');
}

export function renderRoleMatrix() {
  const container = document.getElementById('roleMatrixGrid');
  if (!container) return;
  container.innerHTML = '';

  const rolesMeta = [
    { id: 'NANO_CHAT', title: '⚡ NANO_CHAT', desc: 'Pitches & Smalltalk' },
    { id: 'PLANNER_JSON', title: '📐 PLANNER_JSON', desc: 'Struktur & Topologie' },
    { id: 'ARCHITECT_CODE', title: '🏗️ ARCHITECT_CODE', desc: 'Voll-Synthese & Neubau' },
    { id: 'REGION_DIFF', title: '🔄 REGION_DIFF', desc: 'Umbau & Schematic-Remix' },
    { id: 'SELF_HEAL_REASONING', title: '🧠 SELF_HEAL', desc: 'Linter- & VM-Reparatur' }
  ];

  rolesMeta.forEach(r => {
    const roleData = modelCtx.rolesStatus[r.id] || {};
    const effective = roleData.effectiveEndpoint;
    const pinnedId = modelCtx.roleAssignments[r.id]?.pinnedEndpointId || roleData.pinnedEndpointId;
    const isPinned = Boolean(pinnedId);

    const card = document.createElement('div');
    card.className = `role-card ${isPinned ? 'is-pinned' : ''}`;

    const modelDisplay = effective ? `${effective.provider}: ${effective.model}` : 'Auto-Scoring aktiv';
    const isFree = effective?.isFreeTier;

    card.innerHTML = `
      <div class="role-card-header">
        <span class="role-title">${r.title}</span>
        <span class="role-badge ${isPinned ? 'pinned' : ''}">${isPinned ? '📌 Gepinnt' : (isFree ? 'Free-Tier' : 'Auto-Pick')}</span>
      </div>
      <div class="text-2xs text-muted">${r.desc}</div>
      <div class="role-model-name" title="${modelDisplay}">${modelDisplay}</div>
      <div class="role-stats-row">
        <span>${effective?.capabilities ? `Code: ${effective.capabilities.code} | CoT: ${effective.capabilities.reasoning}` : 'Bereit'}</span>
        <span>${isFree ? 'Kostenlos ($0)' : (effective?.costPer1MInput ? `$${effective.costPer1MInput}/1M` : 'Standard')}</span>
      </div>
      <div class="mt-1">
        <select class="role-pin-select" data-role="${r.id}" aria-label="Modell für ${r.title} anpinnen">
          <option value="auto" ${!isPinned ? 'selected' : ''}>🤖 Automatisch (Smart Auto-Score)</option>
          ${modelCtx.modelEndpoints.map(ep => `
            <option value="${ep.id}" ${pinnedId === ep.id ? 'selected' : ''}>
              ${ep.provider}: ${ep.modelId} ${ep.isFreeTier ? '(Free)' : ''}
            </option>
          `).join('')}
        </select>
      </div>
    `;

    const sel = card.querySelector('.role-pin-select');
    sel.addEventListener('change', (e) => {
      pinRole(r.id, e.target.value);
    });

    container.appendChild(card);
  });
}
