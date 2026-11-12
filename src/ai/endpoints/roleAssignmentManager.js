/**
 * Applies active global routing profile ('eco' | 'balanced' | 'quality').
 *
 * @param {Object} state - EndpointManager instance or state
 * @param {'eco'|'balanced'|'quality'} profile
 * @param {Function} [onProfileChanged]
 * @returns {string}
 */
export function applySetRoutingProfile(state, profile, onProfileChanged) {
  const valid = ['eco', 'balanced', 'quality'];
  if (!valid.includes(profile)) {
    throw new Error(`Ungültiges Routing-Profil: '${profile}'. Erlaubt: ${valid.join(', ')}`);
  }
  state.activeProfile = profile;
  if (typeof onProfileChanged === 'function') {
    onProfileChanged({ profile });
  }
  return state.activeProfile;
}

/**
 * Pins a specific model endpoint to one of the task roles.
 *
 * @param {Object} state - EndpointManager instance or state
 * @param {string} role - TASK_ROLES key (e.g. 'ARCHITECT_CODE')
 * @param {string} endpointId - Endpoint ID to pin
 * @param {Function} [onRolePinned]
 * @returns {Object}
 */
export function applyPinRole(state, role, endpointId, onRolePinned) {
  if (!state.roleAssignments[role]) {
    state.roleAssignments[role] = { pinnedEndpointId: null, effectiveEndpointId: '' };
  }
  const ep = state.endpoints.find(e => e.id === endpointId);
  if (!ep && endpointId !== null) {
    throw new Error(`Endpunkt '${endpointId}' existiert nicht.`);
  }
  state.roleAssignments[role].pinnedEndpointId = endpointId;
  if (endpointId) {
    state.roleAssignments[role].effectiveEndpointId = endpointId;
  }
  if (typeof onRolePinned === 'function') {
    onRolePinned({ role, endpointId });
  }
  return state.roleAssignments[role];
}

/**
 * Unpins a role so it returns to dynamic smart auto-scoring.
 *
 * @param {Object} state - EndpointManager instance or state
 * @param {string} role
 * @param {Function} [onRoleUnpinned]
 * @returns {Object}
 */
export function applyUnpinRole(state, role, onRoleUnpinned) {
  if (state.roleAssignments[role]) {
    state.roleAssignments[role].pinnedEndpointId = null;
  }
  if (typeof onRoleUnpinned === 'function') {
    onRoleUnpinned({ role });
  }
  return state.roleAssignments[role] || { pinnedEndpointId: null, effectiveEndpointId: '' };
}

/**
 * Sets an endpoint as the primary active provider for a tier.
 *
 * @param {Object} state - EndpointManager instance or state
 * @param {'FAST_TIER'|'ARCHITECT_TIER'|'REASONING_TIER'} tier
 * @param {string} endpointId
 * @param {Function} [onTierActivated]
 */
export function applyActivateTier(state, tier, endpointId, onTierActivated) {
  const target = state.endpoints.find(e => e.id === endpointId);
  if (!target) {
    throw new Error(`Endpoint with id '${endpointId}' not found`);
  }

  target.tier = tier;
  target.enabled = true;
  target.priority = 1;

  for (const ep of state.endpoints) {
    if (ep.id !== endpointId && ep.tier === tier) {
      ep.priority = Math.max(2, (ep.priority || 1) + 1);
    }
  }

  if (tier === 'FAST_TIER') {
    state.activeFastEndpointId = endpointId;
  } else if (tier === 'ARCHITECT_TIER') {
    state.activeArchitectEndpointId = endpointId;
  }

  if (typeof onTierActivated === 'function') {
    onTierActivated({ tier, endpointId });
  }
}
