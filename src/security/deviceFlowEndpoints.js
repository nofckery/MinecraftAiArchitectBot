/**
 * Registriert OAuth-Device-Flow Credentials im Vault und die entsprechenden Endpunkte im EndpointManager.
 */
export async function registerDeviceFlowEndpoints({
  vault,
  endpointManager,
  llmRouter,
  provider,
  accessToken,
  log
}) {
  const isHuggingFace = provider.toLowerCase() === 'huggingface' || provider.toLowerCase() === 'hf';
  const credentialRef = isHuggingFace ? 'sec_huggingface' : 'sec_github_models';

  // 1. Vault Storage
  if (vault) {
    await vault.storeSecret(credentialRef, {
      type: 'oauth_device_flow',
      provider,
      token: accessToken.trim(),
      expiresAt: null
    });
  }

  // 2. EndpointManager Upsert
  let endpointId = isHuggingFace ? 'ep_huggingface' : 'ep_github_models';
  if (endpointManager) {
    const all = typeof endpointManager.getAllEndpoints === 'function'
      ? endpointManager.getAllEndpoints()
      : [];

    if (isHuggingFace) {
      // Hugging Face registration
      const existingHf = all.find(e => e.id === 'ep_huggingface' || e.credentialRef === credentialRef);
      if (existingHf) {
        endpointId = existingHf.id;
        await endpointManager.updateEndpoint(existingHf.id, {
          enabled: true,
          authType: 'oauth_device_flow',
          credentialRef,
          baseUrl: 'https://router.huggingface.co/v1',
          modelId: existingHf.modelId || 'meta-llama/Llama-3.3-70B-Instruct:fastest'
        }, accessToken);
      } else {
        const created = await endpointManager.createEndpoint({
          id: 'ep_huggingface',
          name: 'Hugging Face (Llama 3.3 Fastest)',
          provider: 'HuggingFace',
          category: 'cloud',
          tier: 'ARCHITECT_TIER',
          enabled: true,
          priority: 2,
          baseUrl: 'https://router.huggingface.co/v1',
          modelId: 'meta-llama/Llama-3.3-70B-Instruct:fastest',
          authType: 'oauth_device_flow',
          credentialRef,
          temperature: 0.2,
          maxTokens: 4000,
          contextWindow: 128000,
          isThinkingModel: false
        }, accessToken);
        endpointId = created.id;
      }
    } else {
      // GitHub Models registration
      const existing = all.find(e =>
        e.id === 'ep_github_models' ||
        e.credentialRef === credentialRef ||
        (e.provider === 'GitHub' && e.baseUrl && e.baseUrl.includes('models.github.ai'))
      );

      // 2a. Architect Tier Endpoint (GPT-4o)
      if (existing) {
        endpointId = existing.id;
        await endpointManager.updateEndpoint(existing.id, {
          enabled: true,
          authType: 'oauth_device_flow',
          credentialRef,
          baseUrl: 'https://models.github.ai/inference',
          modelId: existing.modelId || 'openai/gpt-4o'
        }, accessToken);
      } else {
        const created = await endpointManager.createEndpoint({
          id: 'ep_github_models',
          name: 'GitHub Models (GPT-4o)',
          provider: 'GitHub',
          category: 'cloud',
          tier: 'ARCHITECT_TIER',
          enabled: true,
          priority: 1,
          baseUrl: 'https://models.github.ai/inference',
          modelId: 'openai/gpt-4o',
          authType: 'oauth_device_flow',
          credentialRef,
          temperature: 0.2,
          maxTokens: 4000,
          contextWindow: 128000,
          isThinkingModel: false
        }, accessToken);
        endpointId = created.id;
      }

      // 2b. Fast Tier Endpoint (GPT-4o-mini)
      const existingFast = all.find(e =>
        e.id === 'ep_github_models_fast' ||
        (e.provider === 'GitHub' && e.baseUrl && e.baseUrl.includes('models.github.ai') && e.tier === 'FAST_TIER')
      );

      if (existingFast) {
        await endpointManager.updateEndpoint(existingFast.id, {
          enabled: true,
          authType: 'oauth_device_flow',
          credentialRef,
          baseUrl: 'https://models.github.ai/inference',
          modelId: existingFast.modelId || 'openai/gpt-4o-mini'
        }, accessToken);
      } else {
        await endpointManager.createEndpoint({
          id: 'ep_github_models_fast',
          name: 'GitHub Models (GPT-4o-mini)',
          provider: 'GitHub',
          category: 'cloud',
          tier: 'FAST_TIER',
          enabled: true,
          priority: 1,
          baseUrl: 'https://models.github.ai/inference',
          modelId: 'openai/gpt-4o-mini',
          authType: 'oauth_device_flow',
          credentialRef,
          temperature: 0.2,
          maxTokens: 4000,
          contextWindow: 128000,
          isThinkingModel: false
        }, accessToken);
      }

      // 2c. Activate primary tiers if supported
      if (typeof endpointManager.activateTier === 'function') {
        try {
          await endpointManager.activateTier('ARCHITECT_TIER', endpointId);
          await endpointManager.activateTier('FAST_TIER', 'ep_github_models_fast');
        } catch (tierErr) {
          log?.warn?.(`[DeviceFlowManager] Konnte Tier nicht aktivieren: ${tierErr.message}`);
        }
      }
    }

    // 3. Hot-Reload Pools in LLMRouter
    if (llmRouter) {
      await llmRouter.reloadPools(endpointManager);
    }
  }

  return {
    endpointId,
    provider: isHuggingFace ? 'HuggingFace' : 'GitHub',
    model: isHuggingFace ? 'meta-llama/Llama-3.3-70B-Instruct:fastest' : 'openai/gpt-4o'
  };
}
