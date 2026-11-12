/**
 * Provider presets, guidance templates, and error taxonomy for Model Cockpit.
 */

export const MODEL_ERROR_TAXONOMY = {
  INVALID_KEY: {
    code: 'INVALID_KEY',
    title: 'Ungültiger API-Schlüssel (HTTP 401)',
    hint: 'Prüfe den API-Schlüssel im Provider-Dashboard auf Tippfehler oder Widerruf.'
  },
  FORBIDDEN: {
    code: 'FORBIDDEN',
    title: 'Zugriff verweigert (HTTP 403)',
    hint: 'Dein Token besitzt möglicherweise nicht die benötigten Berechtigungen oder Scopes.'
  },
  MODEL_NOT_FOUND: {
    code: 'MODEL_NOT_FOUND',
    title: 'Modell nicht gefunden (HTTP 404)',
    hint: 'Modell-ID existiert nicht für diesen Provider. Wähle ein Modell aus dem Provider-Katalog.'
  },
  RATE_LIMIT: {
    code: 'RATE_LIMIT',
    title: 'Rate-Limit erreicht (HTTP 429)',
    hint: 'Kurzfristig überlastet. Das System weicht automatisch auf alternative Anbieter aus.'
  },
  CONNECTION_REFUSED: {
    code: 'CONNECTION_REFUSED',
    title: 'Lokaler Server nicht erreichbar (ECONNREFUSED)',
    hint: 'Starte Ollama (`ollama serve`) oder LM Studio auf dem konfigurierten Port.'
  },
  TIMEOUT: {
    code: 'TIMEOUT',
    title: 'Zeitüberschreitung (ETIMEDOUT)',
    hint: 'Der Server antwortet nicht rechtzeitig. Prüfe Netzwerkverbindung oder Firewall.'
  }
};

export const PROVIDER_PRESETS = {
  Cerebras: {
    name: 'Cerebras Ultra-Fast',
    url: 'https://api.cerebras.ai/v1',
    model: 'llama3.1-8b',
    tier: 'FAST_TIER',
    desc: 'Extrem schnelle Inferenz für Smalltalk und Live-Chat.',
    fields: { secret: 'Cerebras API Key' }
  },
  Groq: {
    name: 'GroqCloud LPU',
    url: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    tier: 'FAST_TIER',
    desc: 'LPU-beschleunigte Inferenz mit hervorragender Token-Rate.',
    fields: { secret: 'Groq API Key (gsk_...)' }
  },
  GitHub: {
    name: 'GitHub Models',
    url: 'https://models.inference.ai.azure.com',
    model: 'gpt-4o',
    tier: 'ARCHITECT_TIER',
    desc: 'Kostenlose Azure AI Modelle via GitHub Personal Access Token oder RFC 8628 Device Flow.',
    fields: { secret: 'GitHub PAT (ghp_...)' }
  },
  Mistral: {
    name: 'Codestral / Mistral',
    url: 'https://codestral.mistral.ai/v1',
    model: 'codestral-latest',
    tier: 'ARCHITECT_TIER',
    desc: 'Spezialisiert auf komplexe Code-Synthese und voxelgenaue Baupläne.',
    fields: { secret: 'Mistral API Key' }
  },
  Gemini: {
    name: 'Google Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.5-flash',
    tier: 'ARCHITECT_TIER',
    desc: 'Sehr großes Kontextfenster für ausgedehnte Minecraft-Bauprojekte.',
    fields: { secret: 'Gemini API Key (AIza...)' }
  },
  OpenRouter: {
    name: 'OpenRouter Aggregator',
    url: 'https://openrouter.ai/api/v1',
    model: 'anthropic/claude-3.5-sonnet',
    tier: 'ARCHITECT_TIER',
    desc: 'Einheitlicher Zugriff auf Claude, GPT-4, Llama 3 und Open-Source Modelle.',
    fields: { secret: 'OpenRouter Key (sk-or-...)' }
  },
  SambaNova: {
    name: 'SambaNova Cloud',
    url: 'https://api.sambanova.ai/v1',
    model: 'Meta-Llama-3.1-70B-Instruct',
    tier: 'ARCHITECT_TIER',
    desc: 'Enterprise SN40L Reconfigurable Dataflow Units.',
    fields: { secret: 'SambaNova Key' }
  },
  HuggingFace: {
    name: 'Hugging Face Router',
    url: 'https://router.huggingface.co/v1',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    tier: 'ARCHITECT_TIER',
    desc: 'OpenAI-kompatibler Serverless-Router zu Tausenden Open-Source Modellen.',
    fields: { secret: 'HuggingFace User Access Token (hf_...)' }
  },
  Ollama: {
    name: 'Ollama (Lokal)',
    url: 'http://localhost:11434/v1',
    model: 'qwen2.5-coder:14b',
    tier: 'ARCHITECT_TIER',
    desc: 'Lokale Ausführung auf eigener GPU ohne Datenübertragung an Cloud-Dienste.',
    fields: { secret: 'Nicht erforderlich (leer lassen)' }
  },
  LMStudio: {
    name: 'LM Studio (Lokal)',
    url: 'http://localhost:1234/v1',
    model: 'local-model',
    tier: 'ARCHITECT_TIER',
    desc: 'Lokaler OpenAI-kompatibler Server mit GUI.',
    fields: { secret: 'Nicht erforderlich (leer lassen)' }
  },
  Custom: {
    name: 'Custom Endpoint',
    url: 'https://api.example.com/v1',
    model: 'custom-model',
    tier: 'FAST_TIER',
    desc: 'Beliebige OpenAI-kompatible REST API.',
    fields: { secret: 'API Key / Bearer Token' }
  }
};

export function updateProviderGuidance(provider) {
  const guidanceEl = document.getElementById('providerGuidance');
  const secretLabel = document.getElementById('lblEndpointSecret');
  const secretHelp = document.getElementById('helpEndpointSecret');
  const preset = PROVIDER_PRESETS[provider] || PROVIDER_PRESETS.Custom;

  if (guidanceEl) {
    guidanceEl.textContent = preset.desc;
  }
  if (secretLabel && preset.fields?.secret) {
    secretLabel.textContent = preset.fields.secret;
  }
  if (secretHelp) {
    if (provider === 'GitHub') {
      secretHelp.innerHTML = 'Benötigt GitHub PAT mit <code>read:user</code> Scope oder nutze 1-Click Device Flow.';
    } else if (provider === 'Ollama' || provider === 'LMStudio') {
      secretHelp.textContent = 'Für lokale Server wird kein API-Schlüssel benötigt.';
    } else if (provider === 'OpenRouter') {
      secretHelp.textContent = 'Beginnt üblicherweise mit sk-or-v1-...';
    } else {
      secretHelp.textContent = 'Wird verschlüsselt gespeichert und niemals im Klartext zurückgegeben.';
    }
  }
}
