/**
 * Records usage telemetry per role and per model.
 *
 * @param {Object} telemetry - Current telemetry state
 * @param {Object} data - { role, modelId, promptTokens, completionTokens, costUSD }
 * @param {Function} [onUpdated] - Callback invoked with telemetry clone
 */
export function recordEndpointTelemetry(telemetry, data = {}, onUpdated) {
  const role = data.role || 'NANO_CHAT';
  const model = data.modelId || 'unknown';
  const prompt = Number(data.promptTokens) || 0;
  const completion = Number(data.completionTokens) || 0;
  const cost = Number(data.costUSD) || 0;

  if (!telemetry.byRole) {
    telemetry.byRole = {};
  }
  if (!telemetry.byRole[role]) {
    telemetry.byRole[role] = { requests: 0, promptTokens: 0, completionTokens: 0, costUSD: 0 };
  }
  telemetry.byRole[role].requests++;
  telemetry.byRole[role].promptTokens += prompt;
  telemetry.byRole[role].completionTokens += completion;
  telemetry.byRole[role].costUSD += cost;

  if (!telemetry.byModel) {
    telemetry.byModel = {};
  }
  if (!telemetry.byModel[model]) {
    telemetry.byModel[model] = { requests: 0, promptTokens: 0, completionTokens: 0, costUSD: 0 };
  }
  telemetry.byModel[model].requests++;
  telemetry.byModel[model].promptTokens += prompt;
  telemetry.byModel[model].completionTokens += completion;
  telemetry.byModel[model].costUSD += cost;

  telemetry.totalRequests = (telemetry.totalRequests || 0) + 1;
  telemetry.totalPromptTokens = (telemetry.totalPromptTokens || 0) + prompt;
  telemetry.totalCompletionTokens = (telemetry.totalCompletionTokens || 0) + completion;
  telemetry.totalCostUSD = (telemetry.totalCostUSD || 0) + cost;

  if (typeof onUpdated === 'function') {
    onUpdated(JSON.parse(JSON.stringify(telemetry)));
  }
}
