import { logger } from '../utils/logger.js';

/**
 * Standard default ports scanned for local inference runners.
 */
export const DEFAULT_LOCAL_PORTS = [11434, 1234, 8000, 8080, 1337];

/**
 * LocalModelScanner
 *
 * Implements zero-config multi-port discovery for local LLM inference engines
 * (Ollama, LM Studio, vLLM, llama.cpp, Jan Desktop) on 127.0.0.1.
 * Extracts model catalogs, active running models, and GPU VRAM offload percentages.
 * Runs in parallel via Promise.allSettled with fast timeouts (< 1200ms per port, < 2000ms total sweep).
 */
export class LocalModelScanner {
  /**
   * @param {Object} [options]
   * @param {number[]} [options.ports]
   * @param {string} [options.host]
   * @param {number} [options.timeoutMs]
   * @param {Object} [options.logger]
   */
  constructor(options = {}) {
    this.ports = options.ports || DEFAULT_LOCAL_PORTS;
    this.host = options.host || '127.0.0.1';
    this.timeoutMs = options.timeoutMs || 1200;
    this.log = options.logger || logger;
  }

  /**
   * Executes parallel sweep across all configured target ports.
   *
   * @param {Object} [options]
   * @param {number[]} [options.ports]
   * @param {string} [options.host]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<Object>} DiscoverResult
   */
  async scan(options = {}) {
    const ports = options.ports || this.ports;
    const host = options.host || this.host;
    const timeoutMs = options.timeoutMs || this.timeoutMs;
    const startTime = performance.now();

    const probeTasks = ports.map(port => this.probePort(host, port, timeoutMs));
    const settlements = await Promise.allSettled(probeTasks);

    const instances = [];
    for (const res of settlements) {
      if (res.status === 'fulfilled' && res.value && res.value.online) {
        instances.push(res.value);
      }
    }

    const durationMs = Math.round(performance.now() - startTime);

    return {
      success: true,
      timestamp: new Date().toISOString(),
      scannedPorts: ports,
      durationMs,
      instances,
      totalFound: instances.length
    };
  }

  /**
   * Probes an individual port on the target host.
   *
   * @param {string} host
   * @param {number} port
   * @param {number} timeoutMs
   * @returns {Promise<Object|null>}
   */
  async probePort(host, port, timeoutMs) {
    const portStartTime = performance.now();

    // 1. First probe Ollama endpoints (/api/tags)
    try {
      const ollamaInstance = await this._probeOllama(host, port, timeoutMs, portStartTime);
      if (ollamaInstance) {
        return ollamaInstance;
      }
    } catch (err) {
      if (this._isFatalOrUnresponsive(err)) {
        // Port is completely closed or hung/unresponsive
        return null;
      }
      // If error was a normal HTTP 404 or other non-timeout error, proceed to OpenAI check
    }

    // 2. Next probe OpenAI-compatible endpoints (/v1/models)
    try {
      const openAiInstance = await this._probeOpenAI(host, port, timeoutMs, portStartTime);
      if (openAiInstance) {
        return openAiInstance;
      }
    } catch (err) {
      // Ignored: port closed, timed out, or non-LLM server
    }

    return null;
  }

  /**
   * Inspects port for Ollama API (/api/tags, /api/ps, /api/version).
   *
   * @private
   */
  async _probeOllama(host, port, timeoutMs, portStartTime) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const tagsUrl = `http://${host}:${port}/api/tags`;
      const res = await fetch(tagsUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      if (!res.ok) {
        return null;
      }

      let tagsData;
      try {
        tagsData = await res.json();
      } catch (_) {
        return null;
      }

      if (!tagsData || !Array.isArray(tagsData.models)) {
        return null;
      }

      const models = tagsData.models
        .map(m => m.name || m.model || String(m))
        .filter(Boolean);

      // Fetch version if available
      let version = 'unknown';
      try {
        const vController = new AbortController();
        const vTimer = setTimeout(() => vController.abort(), Math.min(timeoutMs, 500));
        const vRes = await fetch(`http://${host}:${port}/api/version`, {
          signal: vController.signal,
          headers: { 'Accept': 'application/json' }
        });
        clearTimeout(vTimer);
        if (vRes.ok) {
          const vData = await vRes.json();
          if (vData && vData.version) version = vData.version;
        }
      } catch (_) {}

      // Fetch /api/ps for active model & VRAM telemetry
      let activeModel = null;
      let vramOffloadPercentage = null;
      let vramBytes = null;
      let totalBytes = null;
      let gpuStatus = 'standby';
      let details = {};

      try {
        const psController = new AbortController();
        const psTimer = setTimeout(() => psController.abort(), Math.min(timeoutMs, 500));
        const psRes = await fetch(`http://${host}:${port}/api/ps`, {
          signal: psController.signal,
          headers: { 'Accept': 'application/json' }
        });
        clearTimeout(psTimer);

        if (psRes.ok) {
          const psData = await psRes.json();
          if (psData && Array.isArray(psData.models) && psData.models.length > 0) {
            const active = psData.models[0];
            activeModel = active.name || active.model || null;
            const sizeVram = typeof active.size_vram === 'number' ? active.size_vram : 0;
            const sizeTotal = typeof active.size === 'number' ? active.size : 0;

            vramBytes = sizeVram;
            totalBytes = sizeTotal;

            if (sizeTotal > 0) {
              vramOffloadPercentage = Math.round((sizeVram / sizeTotal) * 100);
            } else if (sizeVram === 0) {
              vramOffloadPercentage = 0;
            }

            if (vramOffloadPercentage === 100) {
              gpuStatus = 'optimal';
            } else if (vramOffloadPercentage !== null && vramOffloadPercentage > 0) {
              gpuStatus = 'hybrid';
            } else {
              gpuStatus = 'cpu_fallback';
            }

            if (active.details) {
              details = active.details;
            }
          }
        }
      } catch (_) {}

      if (Object.keys(details).length === 0 && tagsData.models[0]?.details) {
        details = tagsData.models[0].details;
      }

      const latencyMs = Math.round(performance.now() - portStartTime);

      return {
        engine: 'ollama',
        name: `Ollama (Port ${port})`,
        port,
        baseUrl: `http://${host}:${port}/v1`,
        online: true,
        version,
        models,
        activeModel,
        vramOffloadPercentage,
        vramBytes,
        totalBytes,
        gpuStatus,
        latencyMs,
        details
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Inspects port for standard OpenAI-compatible API (/v1/models).
   *
   * @private
   */
  async _probeOpenAI(host, port, timeoutMs, portStartTime) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const modelsUrl = `http://${host}:${port}/v1/models`;
      const res = await fetch(modelsUrl, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });

      if (!res.ok) {
        return null;
      }

      let data;
      try {
        data = await res.json();
      } catch (_) {
        return null;
      }

      const rawList = Array.isArray(data?.data)
        ? data.data
        : (Array.isArray(data?.models) ? data.models : (Array.isArray(data) ? data : null));

      if (!rawList) {
        return null;
      }

      const models = rawList
        .map(item => (typeof item === 'string' ? item : item?.id || ''))
        .filter(Boolean);

      // Identify engine by port signature or payload hints
      let engine = 'local_openai';
      let name = `Local Runner (Port ${port})`;

      const serverHeader = (res.headers.get('server') || '').toLowerCase();
      const hasLmStudioHint = serverHeader.includes('lmstudio') ||
        rawList.some(item => typeof item === 'object' && item?.owned_by === 'lmstudio');

      if (port === 1234 || hasLmStudioHint) {
        engine = 'lmstudio';
        name = `LM Studio (Port ${port})`;
      } else if (port === 8000) {
        engine = 'vllm';
        name = `vLLM (Port ${port})`;
      } else if (port === 8080) {
        engine = 'llamacpp';
        name = `llama.cpp (Port ${port})`;
      } else if (port === 1337) {
        engine = 'jan';
        name = `Jan Desktop (Port ${port})`;
      }

      const latencyMs = Math.round(performance.now() - portStartTime);

      return {
        engine,
        name,
        port,
        baseUrl: `http://${host}:${port}/v1`,
        online: true,
        version: 'unknown',
        models,
        activeModel: null,
        vramOffloadPercentage: null,
        vramBytes: null,
        totalBytes: null,
        gpuStatus: 'standby',
        latencyMs,
        details: {}
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Helper to identify immediate ECONNREFUSED socket failures or hung timeouts.
   *
   * @param {any} err
   * @returns {boolean}
   * @private
   */
  _isFatalOrUnresponsive(err) {
    if (!err) return false;
    const code = err.code || err.cause?.code;
    const name = err.name || err.cause?.name;
    const msg = (err.message || '').toLowerCase();
    const causeMsg = (err.cause?.message || '').toLowerCase();
    const isConnRefused = code === 'ECONNREFUSED' ||
      msg.includes('econnrefused') ||
      causeMsg.includes('econnrefused');
    const isTimeout = name === 'AbortError' ||
      name === 'TimeoutError' ||
      code === 'ETIMEDOUT' ||
      msg.includes('aborted') ||
      msg.includes('timeout') ||
      causeMsg.includes('timeout');
    return isConnRefused || isTimeout;
  }
}

export const localModelScanner = new LocalModelScanner();

/**
 * Functional wrapper for ad-hoc local scanning.
 *
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
export async function scanLocalModelServers(options) {
  return localModelScanner.scan(options);
}
