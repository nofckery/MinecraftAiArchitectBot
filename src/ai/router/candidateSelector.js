import { TASK_ROLES, computeRoleScore } from '../modelKnowledgeBase.js';

/**
 * Filtert und priorisiert Endpunkt-Kandidaten für eine gegebene Task-Rolle.
 */
export function getCandidatesForRole({
  role,
  attempt = 1,
  allEndpoints = [],
  fastEndpoints = [],
  architectEndpoints = [],
  roleAssignments = {},
  activeProfile = 'eco'
}) {
  let effectiveRole = role;
  if (role === 'FAST_TIER') effectiveRole = TASK_ROLES.PLANNER_JSON;
  if (role === 'ARCHITECT_TIER') effectiveRole = TASK_ROLES.ARCHITECT_CODE;

  // Self-healing escalation for attempts > 1
  if (attempt === 2 && (effectiveRole === TASK_ROLES.ARCHITECT_CODE || effectiveRole === TASK_ROLES.SELF_HEAL_REASONING)) {
    effectiveRole = TASK_ROLES.SELF_HEAL_REASONING;
  } else if (attempt >= 3) {
    effectiveRole = TASK_ROLES.SELF_HEAL_REASONING;
  }

  const pool = allEndpoints.length > 0
    ? allEndpoints
    : [...new Set([...fastEndpoints, ...architectEndpoints])];

  const pinnedId = roleAssignments?.[effectiveRole]?.pinnedEndpointId;
  const profile = activeProfile || 'eco';

  const available = pool.filter(e => !e.disabled && e.isAvailable());

  const scored = available.map(ep => {
    const isPinned = pinnedId && ep.id === pinnedId;
    let score = computeRoleScore(ep, effectiveRole, profile);
    if (isPinned) score += 10000;
    if (attempt >= 3 && ep.isThinkingModel) score += 500;
    return { ep, score };
  });

  scored.sort((a, b) => b.score - a.score);

  const candidates = scored.map(s => s.ep);

  if (candidates.length === 0) {
    const nonDisabled = pool.filter(e => !e.disabled);
    return nonDisabled.length > 0 ? nonDisabled : pool;
  }

  return candidates;
}
