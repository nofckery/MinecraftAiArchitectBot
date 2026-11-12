import { EndpointManager } from '../../ai/endpointManager.js';
import { SafeProbeWorker } from '../../ai/safeProbeWorker.js';
import { DeviceFlowManager } from '../../security/deviceFlowManager.js';
import { PkceAuthManager } from '../../security/pkceAuthManager.js';
import { localModelScanner, LocalModelScanner } from '../../ai/localModelScanner.js';
import { msaAuthManager } from '../../security/msaAuthManager.js';
import { llmRouter } from '../../ai/llmRouter.js';

/**
 * Initializes and lazily instantiates missing dependency services.
 *
 * @param {Object} server - DashboardServer instance
 */
export async function ensureServices(server) {
  if (!server.endpointManager) {
    server.endpointManager = new EndpointManager();
    await server.endpointManager.init();
  }
  if (!server.safeProbeWorker) {
    server.safeProbeWorker = new SafeProbeWorker();
  }
  if (!server.localModelScanner) {
    server.localModelScanner = localModelScanner || new LocalModelScanner();
  }
  if (!server.deviceFlowManager) {
    server.deviceFlowManager = new DeviceFlowManager({
      endpointManager: server.endpointManager,
      llmRouter: server.llmRouter || llmRouter
    });
  }
  if (!server.pkceAuthManager) {
    server.pkceAuthManager = new PkceAuthManager({
      endpointManager: server.endpointManager,
      vault: server.endpointManager?.vault,
      llmRouter: server.llmRouter || llmRouter
    });
  }

  wireServiceEvents(server);
}

/**
 * Wires service events from EndpointManager, SafeProbeWorker, DeviceFlowManager,
 * PkceAuthManager, and MsaAuthManager to server.broadcast().
 *
 * @param {Object} server - DashboardServer instance
 */
export function wireServiceEvents(server) {
  if (server._eventsWired) return;
  server._eventsWired = true;

  if (server.endpointManager) {
    server.endpointManager.on('endpoint_status_change', (evt) => {
      server.broadcast({ type: 'endpoint_status_change', ...evt });
    });
    server.endpointManager.on('tier_activated', (evt) => {
      server.broadcast({ type: 'tier_activated', ...evt });
    });
    server.endpointManager.on('endpoint_created', (ep) => {
      server.broadcast({ type: 'endpoint_created', endpoint: ep });
    });
    server.endpointManager.on('endpoint_updated', (ep) => {
      server.broadcast({ type: 'endpoint_updated', endpoint: ep });
    });
    server.endpointManager.on('endpoint_deleted', (id) => {
      server.broadcast({ type: 'endpoint_deleted', id });
    });
  }

  if (server.safeProbeWorker) {
    server.safeProbeWorker.on('progress', (prog) => {
      server.broadcast({ type: 'probe_progress', ...prog });
    });
  }

  if (server.deviceFlowManager) {
    server.deviceFlowManager.on('authenticated', (evt) => {
      server.broadcast({ type: 'device_auth_success', ...evt });
    });
    server.deviceFlowManager.on('device_auth_success', (evt) => {
      server.broadcast({ type: 'device_auth_success', ...evt });
    });
  }

  if (server.pkceAuthManager) {
    server.pkceAuthManager.on('authenticated', (evt) => {
      server.broadcast({ type: 'openrouter_auth_success', ...evt });
    });
  }

  // Microsoft Authentication Events
  msaAuthManager.on('code', (session) => {
    server.broadcast({
      type: 'msa_code',
      userCode: session.userCode,
      verificationUri: session.verificationUri,
      directUrl: session.directUrl,
      expiresIn: session.expiresIn,
      message: session.message,
      username: session.username
    });
  });

  msaAuthManager.on('success', (session) => {
    server.broadcast({
      type: 'msa_success',
      username: session.profile?.name || session.username,
      profile: session.profile
    });
  });

  msaAuthManager.on('error', (err) => {
    server.broadcast({
      type: 'msa_error',
      error: err.error || err.message,
      username: err.username
    });
  });
}
