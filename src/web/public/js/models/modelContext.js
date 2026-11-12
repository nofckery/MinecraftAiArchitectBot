/**
 * Shared state and context for Model Cockpit submodules.
 */

export const modelCtx = {
  modelEndpoints: [],
  activeFastTierEndpointId: null,
  activeArchitectTierEndpointId: null,
  zeroKeyFallbackEnabled: true,
  localScanResults: [],
  deviceFlowSession: null,
  isModelModalOpen: false,
  editingEndpointId: null,
  deviceCountdownInterval: null,
  devicePollInterval: null,

  // v3.0 Profile & Matrix State
  activeProfile: 'eco',
  roleAssignments: {},
  rolesStatus: {},
  telemetryData: {}
};
