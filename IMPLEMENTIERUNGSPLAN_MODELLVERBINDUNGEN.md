# Implementierungsplan: Universelle Modellendpunkt- & KI-Verbindungsinfrastruktur für das Minecraft Architect Cockpit

**Projekt:** Autonomous Low-Resource AI Minecraft Architect Bot (`mc-architect-bot` v2.0 SOTA)  
**Dokumentversion:** 1.0.0 (Masterwork Architecture & Implementation Specification)  
**Datum:** 4. November 2026  
**Status:** Genehmigt zur Implementierung (Ready for Engineering Execution)  
**Autoren & Beitragende:** Architecture Board (Synthese aus Survey R1, SOTA-Recherche R2 und Cockpit-Spezifikation R3)

---

## Inhaltsverzeichnis
1. **Executive Summary & Zielsetzung**
   - 1.1 Motivation & Ausgangslage
   - 1.2 Projektscope & Zielarchitektur
   - 1.3 Zentrale Entwurfsprinzipien (Zero-Friction, Zero-Leak, Zero-Downtime, Multi-Tier Fallback)
2. **Detaillierte Ist-Analyse der bestehenden Modell- und LLM-Anbindung (R1)**
   - 2.1 Provider-Katalog, 4-Stufen-Kaskade & Zero-Key Gateways
   - 2.2 SDK-Landschaft, Client-Instanziierung (`openai ^4.85.0`) & Fehlende Bibliotheken
   - 2.3 Konfigurationspfade & Vollständiges Umgebungsvariablen-Inventar
   - 2.4 Runtime-Auswahl, Kaskaden-Logik (`llmRouter.js`) & Key-Pooling
   - 2.5 Konsumierende Bot-Subsysteme (`architectAgent.js`, `chatController.js`, `dashboardServer.js`)
   - 2.6 Bestehende Fehlerbehandlung, Timeout-Lücken (10-Minuten-Hang-Gefahr) & Flüchtige Fehlerzustände
   - 2.7 Schwachstellen, Hardcodings und Limitierungen
3. **SOTA- und Best-Practice-Recherche (R2)**
   - 3.1 Authentifizierungs-Landschaft & Machbarkeitsanalyse führender LLM-Provider
   - 3.2 RFC 8628 Device Authorization Grant (Königsweg GitHub Models für GPT-4o, Llama 3.3, Mistral Large)
   - 3.3 OAuth 2.0 PKCE Flow (OpenRouter für Universal-Modelle)
   - 3.4 Analyse: OpenAI ChatGPT Plus/Pro vs. Platform API (ToS, Cloudflare Turnstile & Machbarkeitsgrenzen)
   - 3.5 Lokale & Self-Hosted Inferenz (Zero-Config Multi-Port-Sweep, VRAM-Offload-Telemetrie via `/api/ps`, BFF-Proxy gegen Browser-CORS & PNA)
   - 3.6 Kryptographische Zugangsdaten-Speicherung (DPAPI vs. Authenticated Encrypted Local Vault mit AES-256-GCM + Scrypt via nativem `node:crypto`)
   - 3.7 Masked Write-Only Credential Protocol (`sk-...abcd`) & Frontend-Schutz
4. **Lückenloser Implementierungsplan & Architekturspezifikation (R3)**
   - 4.1 UI/UX-Architektur & Navigationsintegration im Dashboard (Header-Pill, CAD-Overlay, 4 visuelle Zonen)
   - 4.2 Schrittweiser Ablauf der Verbindungseinrichtung (Flow A–D)
   - 4.3 Exaktes Daten- und Speichermodell (TypeScript-Interfaces, Vault, Hot-Reload Event-Bus)
   - 4.4 Verbindungsprüfung: Two-Tier Safe Probe (Zero-Cost Metadaten & 1-Token Ping)
   - 4.5 Fehler-Taxonomie & UX-Feedback-Matrix
   - 4.6 REST-API & WebSocket Wire-Protokoll-Spezifikation
   - 4.7 Phasen-, Migrations- und Rollout-Plan (Dateien, Änderungen, Testabdeckung, Rollback-Strategie)

---

# 1. Executive Summary & Zielsetzung

### 1.1 Motivation & Ausgangslage
Der Autonomous Minecraft Architect Bot (`mc-architect-bot`) transformiert natürliche Spieleranfragen und Chatbefehle über KI-Modelle in echtzeitfähige Voxel-Architektur, JavaScript-Bauskripte für die `VoxelCanvas` und koordinierte Blockplatzierungen auf Minecraft-Servern. 

Während der interne Kern-Router (`src/ai/llmRouter.js`) über eine hochentwickelte 4-stufige Provider-Kaskade mit automatischer 429-Erkennung, Retry-After-Header-Auswertung und Key-Rotation verfügt, weist das Gesamtsystem an der Schnittstelle zum Benutzer signifikante Barrieren auf:
1. **Manuelle Hürden:** Die Einrichtung erfordert das mühsame, fehleranfällige Kopieren kryptischer API-Schlüssel in eine Textdatei (`.env`).
2. **Statische Starre:** Neue Schlüssel oder geänderte Modellbezeichner erzwingen zwingend einen Neustart des gesamten Node.js-Prozesses. Dies bricht laufende Bauaufträge und Server-Sitzungen ab.
3. **Fehlende Cockpit-Integration:** Das moderne Dark-CAD Web-Dashboard (`Architect Mission Control v2.0`) besitzt keinerlei Einstellungsseite für LLMs; die Header-Pille `#pillLlmProvider` ist ein reines, passives Anzeigeelement.
4. **Isolierte lokale Inferenz:** Lokale Runner (Ollama, LM Studio, vLLM) können nicht komfortabel angebunden werden, da alle Provider-URLs statisch im Quellcode verankert sind und Browser-Sicherheitsrichtlinien (CORS, Private Network Access) direkte Frontend-Probes blockieren.
5. **Sicherheitsrisiko:** API-Keys liegen unverschlüsselt im Klartext auf dem Dateisystem.

### 1.2 Projektscope & Zielarchitektur
Ziel dieses Implementierungsplans ist die Bereitstellung einer **durchgängigen, schlüssellosen, echtzeitfähigen und kryptographisch abgesicherten Modellverbindungs-Infrastruktur** mit vollständiger Integration in das Web-Dashboard.

```
+==================================================================================================+
|                       ARCHITECT MISSION CONTROL v2.0 — CONTROL COCKPIT                          |
+==================================================================================================+
|  [Header-Pill: Cerebras (42ms) ⚙️] ------------> [Full-Screen Modal: #modalModelSettings]        |
|                                                  |                                               |
|  +--------------------------------------------+  |  +-----------------------------------------+  |
|  | Zone 1: Tier-Zuweisung (Fast / Architect)  |  |  | Zone 2: Zero-Config Local Scanner       |  |
|  +--------------------------------------------+  |  +-----------------------------------------+  |
|  | Zone 3: Provider-Grid (OAuth / Keys / Local)|  |  | Zone 4: Live Telemetrie & Quoten-Monitor|  |
|  +--------------------------------------------+  |  +-----------------------------------------+  |
+==================================================================================================+
                                 |  REST / WebSocket (BFF-Proxy)
                                 v
+==================================================================================================+
|                               NODE.JS BACKEND RUNTIME (BFF LAYER)                                |
+==================================================================================================+
|  [EndpointManager] <--------> [CredentialVault: AES-256-GCM + Scrypt via node:crypto (Zero Dep)] |
|         |                            |                                                           |
|         v                            v                                                           |
|  [SafeProbeWorker]             [data/credentials.vault] + [data/endpoints.json]                  |
|  (Phase 1: Zero-Cost /models         |                                                           |
|   Phase 2: 1-Token Ping)             v                                                           |
|         |                     [llmRouter.reloadPools()]  (Unterbrechungsfreier Hot-Reload)       |
|         v                            |                                                           |
|  +--------------------------------------------------------------------------------------------+  |
|  | LLMRouter v2.1 Pools: FAST_TIER, ARCHITECT_TIER, REASONING_TIER, ZERO_KEY_GATEWAY          |  |
+==================================================================================================+
         |                                |                               |
         v                                v                               v
+------------------+            +-------------------+           +-------------------+
|  1-Click Device  |            |  Lokale Inferenz  |           | Cloud Provider    |
|  (GitHub Models) |            |  (Ollama/LMStudio)|           | (Groq/Cerebras/   |
|  RFC 8628 Flow   |            |  Multi-Port Sweep |           |  Mistral/Gemini)  |
+------------------+            +-------------------+           +-------------------+
```

### 1.3 Zentrale Entwurfsprinzipien
1. **Zero-Friction Onboarding:** Anwender können modernste Großmodelle (GPT-4o, Llama 3.3 70B, Mistral Large) über den **RFC 8628 Device Authorization Grant** via persönlichem GitHub-Account oder via OpenRouter PKCE mit einem Klick schlüssellos und kostenlos anbinden.
2. **Zero-Leak Security (Write-Only & Vault):** Zugangsdaten werden niemals im Klartext an den Browser gesendet. Existierende Keys werden als `sk-...abcd` maskiert. Die Speicherung erfolgt in einem manipulationsgeschützten AES-256-GCM Vault ohne native C++ Build-Abhängigkeiten.
3. **Zero-Downtime Hot-Reloading:** Modellwechsel, Key-Rotations oder Tier-Neuzuweisungen aktualisieren die In-Memory-Pools im `llmRouter` im laufenden Betrieb, ohne dass der Minecraft-Bot getrennt wird oder Bauaufträge abbrechen.
4. **Zero-CORS BFF Proxy:** Das Dashboard-Frontend führt keine direkten Netzwerkanfragen an Drittserver oder lokale Ports aus. Alle Abfragen laufen über den Backend-for-Frontend (BFF) Proxy in Express, wodurch Browser-CORS und Private Network Access (PNA) Restriktionen vollständig eliminiert werden.
5. **Two-Tier Safe Probing:** Verbindungstests erfolgen primär kostenfrei ($0.00 / 0 Tokens) über Metadaten-Endpunkte und erst sekundär über einen minimalen 1-Token Ping mit Latenz- und Quoten-Benchmarking.

---

# 2. Detaillierte Ist-Analyse der bestehenden Modell- und LLM-Anbindung (R1)

### 2.1 Provider-Katalog, 4-Stufen-Kaskade & Zero-Key Gateways
Die forensische Untersuchung der Codebase (`src/ai/llmRouter.js`, `src/config/settings.js`) belegt, dass der Bot aktuell über eine statisch definierte 4-stufige Kaskade sowie zwei Notfall-Gateways verfügt. Insgesamt sind **12 Endpunkt-Familien** im Quellcode registriert:

| Stufe | Provider | Default-Modell | Hardcodierte Base-URL | API-Key Umgebungsvariable | Code-Referenz |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Stufe 1 (High-Speed)** | **Cerebras** | Fast: `llama-3.3-70b`<br>Arch: `gpt-oss-120b` | `https://api.cerebras.ai/v1` | `CEREBRAS_API_KEYS` (Komma-separiert) | `llmRouter.js:77-88` |
| **Stufe 1 (High-Speed)** | **GroqCloud** | Fast: `llama-3.3-70b-versatile`<br>Arch: `openai/gpt-oss-120b` | `https://api.groq.com/openai/v1` | `GROQ_API_KEYS` (Komma-separiert) | `llmRouter.js:91-102` |
| **Stufe 2 (Code/Reasoning)** | **Codestral** | Arch: `codestral-latest` / `codestral-2501` | `https://codestral.mistral.ai/v1` | `CODESTRAL_API_KEYS` (Komma-separiert) | `llmRouter.js:110-114` |
| **Stufe 2 (Code/Reasoning)** | **Mistral AI** | Fast: `mistral-small-latest`<br>Arch: `codestral-2501` | `https://api.mistral.ai/v1` | `MISTRAL_API_KEYS` (Komma-separiert) | `llmRouter.js:115-126` |
| **Stufe 2 (Code/Reasoning)** | **Google Gemini** | Fast: `gemini-2.5-flash`<br>Arch: `gemini-2.5-flash` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `GEMINI_API_KEYS` (Komma-separiert) | `llmRouter.js:129-140` |
| **Stufe 3 (Cloud/NIM)** | **SambaNova Cloud** | Arch: `DeepSeek-V3.1` (Tageslimit: 20 RPD) | `https://api.sambanova.ai/v1` | `SAMBANOVA_API_KEYS` (Komma-separiert) | `llmRouter.js:147-154` |
| **Stufe 3 (Cloud/NIM)** | **Cloudflare AI** | Arch: `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | `https://api.cloudflare.com/client/v4/accounts/${settings.CLOUDFLARE_ACCOUNT_ID}/ai/v1` | `CLOUDFLARE_API_TOKEN` & `CLOUDFLARE_ACCOUNT_ID` | `llmRouter.js:157-162` |
| **Stufe 3 (Cloud/NIM)** | **NVIDIA NIM** | Arch: `nvidia/nemotron-3-super-120b-a12b` | `https://integrate.api.nvidia.com/v1` | `NVIDIA_NIM_API_KEYS` (Komma-separiert) | `llmRouter.js:165-169` |
| **Stufe 4 (Community/Global)** | **OpenRouter** | Fast: `meta-llama/llama-3.3-70b-instruct:free`<br>Arch: `openai/gpt-oss-120b:free` | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEYS` (Komma-separiert) | `llmRouter.js:176-187` |
| **Stufe 4 (Community/Global)** | **Zhipu AI** | Fast/Arch: `glm-4-flash` | `https://open.bigmodel.cn/api/paas/v4` | `ZHIPU_API_KEYS` (Komma-separiert) | `llmRouter.js:190-197` |
| **Stufe 4 (Community/Global)** | **SiliconFlow** | Fast/Arch: `Qwen/Qwen3-8B` | `https://api.siliconflow.com/v1` | `SILICONFLOW_API_KEYS` (Komma-separiert) | `llmRouter.js:200-207` |
| **Zero-Key Notfall** | **Kilo AI Gateway** | Fast/Arch: `kilo-auto/free` | `process.env.KILO_GATEWAY_URL` (Default: `https://api.kilo.ai/api/gateway`) | Dummy Key `'dummy-key'` / `'none'` | `llmRouter.js:215-218` |
| **Zero-Key Notfall** | **LLM7 Gateway** | Fast/Arch: `turbo` | `process.env.LLM7_GATEWAY_URL` (Default: `https://api.llm7.io/v1`) | Dummy Key `'dummy-key'` / `'none'` | `llmRouter.js:221-224` |

#### Vollständig fehlende Provider-Segmente im Ist-Stand:
- **Anthropic Claude:** Keinerlei SDKs, Klassen oder Umgebungsvariablen für die native Anthropic Messages API (`api.anthropic.com/v1/messages`).
- **OpenAI Platform (Direkt):** Keine Konfigurationsvariable `OPENAI_API_KEY` und kein Endpunkt auf `https://api.openai.com/v1`.
- **Lokale Runner (Ollama, LM Studio, vLLM, LocalAI):** Keine Voreinstellungen oder Host-Mappings vorhanden.
- **GitHub Models:** Nach Abschaltung der alten Preview-Domain im Juli 2026 noch nicht an das moderne Produktions-Gateway angebunden.

### 2.2 SDK-Landschaft, Client-Instanziierung & Fehlende Bibliotheken
- **Einzige LLM-Bibliothek:** `package.json` führt ausschließlich:
  ```json
  "dependencies": {
    "openai": "^4.85.0"
  }
  ```
- **Einheitliche Instanziierung (`src/ai/llmRouter.js:27-30`):**
  Alle 12 Endpunkte werden identisch als OpenAI-Client-Instanz erzeugt:
  ```javascript
  this.client = new OpenAI({
    apiKey: this.apiKey || 'dummy-key',
    baseURL: this.baseURL
  });
  ```
- **Exklusive API-Methode:** `endpoint.client.chat.completions.create(requestPayload)`. Weder HTTP-Streaming (`stream: true`), Function/Tool-Calling noch die Embeddings-API werden verwendet.

### 2.3 Konfigurationspfade & Vollständiges Umgebungsvariablen-Inventar
Die Konfiguration wird beim Prozessstart über `dotenv.config()` in `src/config/settings.js` geladen:
1. **API-Schlüssel:** `CEREBRAS_API_KEYS`, `GROQ_API_KEYS`, `MISTRAL_API_KEYS`, `CODESTRAL_API_KEYS`, `GEMINI_API_KEYS`, `SAMBANOVA_API_KEYS`, `CLOUDFLARE_API_TOKEN` (& `CLOUDFLARE_ACCOUNT_ID`), `NVIDIA_NIM_API_KEYS`, `OPENROUTER_API_KEYS`, `ZHIPU_API_KEYS`, `SILICONFLOW_API_KEYS`.
2. **Modell-IDs:** `CEREBRAS_FAST_MODEL`, `CEREBRAS_ARCHITECT_MODEL`, `GROQ_FAST_MODEL`, `GROQ_ARCHITECT_MODEL`, `MISTRAL_FAST_MODEL`, `MISTRAL_ARCHITECT_MODEL`, `GEMINI_FAST_MODEL`, `GEMINI_ARCHITECT_MODEL`, `SAMBANOVA_MODEL`, `CLOUDFLARE_MODEL`, `NVIDIA_NIM_MODEL`, `OPENROUTER_FAST_MODEL`, `OPENROUTER_ARCHITECT_MODEL`, `ZHIPU_MODEL`, `SILICONFLOW_MODEL`, `KILO_MODEL`, `LLM7_MODEL`.
3. **Gateways & Schalter:** `ENABLE_ZERO_KEY_FALLBACK` (Default: `true`), `KILO_GATEWAY_URL`, `LLM7_GATEWAY_URL`.

### 2.4 Runtime-Auswahl, Kaskaden-Logik & Key-Pooling
In `src/ai/llmRouter.js` initialisiert `initPools()` zwei Arrays: `fastEndpoints` und `architectEndpoints`.
- **Key-Pooling:** Werden kommasortierte Keys übergeben (z. B. `GROQ_API_KEYS=key1,key2`), wird für jeden Key eine eigene `Endpoint`-Instanz instanziiert.
- **Auswahl:** `executeRequest` filtert Kandidaten mittels `isAvailable()`:
  - `!this.disabled` (wurde nicht durch HTTP 401/403 gesperrt)
  - `this.requestsToday < this.dailyRequestLimit` (SambaNova Limit: 20 RPD)
  - `Date.now() >= this.cooldownUntil` (nicht in Cooldown nach 429 oder Netzwerkfehler)
- **Fehlerweiterleitung:** Schlägt ein Endpunkt fehl, triggert `handleError()` den Cooldown und springt in derselben `for`-Schleife sofort zum nächsten verfügbaren Kandidaten.

### 2.5 Konsumierende Bot-Subsysteme
| Subsystem | Quellcode-Pfad | Aufgerufene Router-Methode | Zweck & Verhalten |
| :--- | :--- | :--- | :--- |
| **Architektur-Konzept & Stil-Pitch** | `src/ai/architectAgent.js:105-121` | `llmRouter.completeJSON('FAST_TIER', ...)` | Schneller 2-Satz-Vorschlag im JSON-Format (`pitchMessage`, `chosenStyle`, `features`) für den Minecraft-Chat. |
| **Primäre Code-Synthese (Neu)** | `src/ai/architectAgent.js:133-144` | `llmRouter.generateCode(..., 'ARCHITECT_TIER')` | Synthese von vollständigem JavaScript-Code zur Steuerung der `VoxelCanvas` über das `arch`-SDK. |
| **Inkrementelles Diff-Building** | `src/ai/architectAgent.js:127-131` | `llmRouter.generateCode(..., 'ARCHITECT_TIER')` | Modifikation des bestehenden Bauskripts anhand von Feedback. |
| **Linter- & Sandbox-Self-Healing** | `src/ai/architectAgent.js:184-225` | `llmRouter.generateCode(..., 'ARCHITECT_TIER')` | Bis zu 3-stufige automatische Fehlerkorrektur bei `node:vm` Syntaxfehlern oder schwebenden Blöcken. |
| **Selektives 3D-Region-Refinement**| `src/ai/architectAgent.js:331-381` | `llmRouter.generateCode(..., 'ARCHITECT_TIER')` | Überarbeitung eines im Dashboard markierten Bereichs (Selection Box). |
| **Schematic-Remixing** | `src/ai/architectAgent.js:439-490` | `llmRouter.generateCode(..., 'ARCHITECT_TIER')` | KI-Erweiterung und Stil-Transfer für `.schem` und `.litematic` Dateien. |
| **Chat- & Web-Controller** | `src/bot/chatController.js` & `dashboardServer.js` | Delegiert an `architectAgent`, fragt `getActiveProviderName()` ab | Telemetrie-Broadcast an das Web-UI und Ingame-Chat-Antworten. |

### 2.6 Bestehende Fehlerbehandlung, Timeout-Lücken & Flüchtige Fehlerzustände
- **HTTP 401/403:** Setzt `endpoint.disabled = true`. Der Key wird bis zum Prozessende nicht mehr genutzt.
- **HTTP 429:** Liest `retry-after` Header. Falls vorhanden: `waitMs = sec * 1000`, sonst Fallback: `65.000 ms`. Setzt `endpoint.cooldownUntil`.
- **Kritische Timeout-Lücke (10-Minuten-Hang-Gefahr):**
  Die Instanziierung in `llmRouter.js:27-30` übergibt **kein `timeout`-Attribut** an das `OpenAI`-SDK. Das Standard-Timeout der Bibliothek beträgt **600.000 ms (10 Minuten)**. Antwortet ein Drittanbieter-Gateway nicht oder stockt die Verbindung, blockiert der gesamte asynchrone Call-Stack des Bots für bis zu 10 Minuten!
- **Flüchtige Fehlerzustände:** Deaktivierte Schlüssel und Cooldowns existieren rein im RAM. Ein Neustart des Bots reaktiviert fehlerhafte Schlüssel unweigerlich wieder.

### 2.7 Schwachstellen, Hardcodings und Limitierungen
1. **Kein Einstellungsdialog:** Im Web-Cockpit können keine Endpunkte eingerichtet, editiert oder getestet werden.
2. **Hardcodierte URLs:** 10 von 12 Providern haben ihre `baseURL` fest im Code verdrahtet.
3. **Fehlende lokale Erkennung:** Lokale Inferenzserver müssen manuell per Code-Patch eingebunden werden.
4. **Fehlende moderne Authentifizierung:** Weder Device Flow (RFC 8628) noch OAuth PKCE werden unterstützt.
5. **Klartext-Speicherung:** Alle sensiblen Zugangsdaten liegen unverschlüsselt in `.env`.
6. **Fehlende Sampler-Freiheit:** `temperature: 0.2` und Token-Limits sind fest eincodiert.

---

# 3. SOTA- und Best-Practice-Recherche (R2)

### 3.1 Authentifizierungs-Landschaft & Machbarkeitsanalyse führender LLM-Provider
Die SOTA-Recherche zeigt ein klares Bild der Authentifizierungsmechanismen moderner KI-Plattformen:

| Provider | Auth-Methoden | Device Flow (RFC 8628) | PKCE Flow | API Key | Eignung für Dashboard Cockpit |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GitHub Models** | Device Flow, OAuth, PAT | **Ja (Nativ)** | Ja | Ja | ⭐⭐⭐⭐⭐ **Exzellent** (Kostenlos GPT-4o & Llama 3.3, kein API-Key nötig) |
| **OpenRouter** | OAuth PKCE, API Key | Nein (Redirect) | **Ja (Nativ)** | Ja | ⭐⭐⭐⭐⭐ **Exzellent** (Universal-Gateway, 1-Klick-Setup) |
| **Azure OpenAI** | Entra ID Device Flow, API Key | **Ja (Nativ)** | Ja | Ja | ⭐⭐⭐⭐ **Sehr gut** (Enterprise-Installationen) |
| **Hugging Face** | OAuth PKCE, API Token | Nein (Redirect) | **Ja (Nativ)** | Ja | ⭐⭐⭐⭐ **Sehr gut** (Open-Source Serverless) |
| **Google Gemini (AI Studio)** | API Key | Nein | Nein | **Ja** | ⭐⭐⭐⭐ **Standard** (Schnelle Keys, 1M Kontext) |
| **Cerebras / GroqCloud** | API Key | Nein | Nein | **Ja** | ⭐⭐⭐⭐ **High-Speed Pflicht** (Manuelle Key-Eingabe) |
| **Mistral / Codestral** | API Key | Nein | Nein | **Ja** | ⭐⭐⭐⭐ **Architect Pflicht** (Manuelle Key-Eingabe) |
| **OpenAI (Direct Platform)** | Project API Key | Nein | Nein | **Ja** | ⭐⭐⭐⭐ **Standard** (Manuelle Key-Eingabe) |

### 3.2 RFC 8628 Device Authorization Grant (Königsweg GitHub Models)
Der **RFC 8628 Device Authorization Grant** ist der Goldstandard für Endgeräte und lokale Dashboards. Er erfordert **keine lokale Callback-URL und keine Browser-Umleitung**.

#### Ablauf-Spezifikation (Sequence):
1. **Initiierung (Backend -> Provider):**  
   Das Backend sendet `POST https://github.com/login/device/code` mit `client_id` und `scope: "read:user"`.
2. **Präsentation (Backend -> Frontend):**  
   Der Anwender erhält einen 8-stelligen Kopplungscode (z. B. `WDJB-WQWD`), einen direkten Verifikationslink (`https://github.com/login/device?user_code=WDJB-WQWD`) sowie einen dynamisch gerenderten QR-Code.
3. **Hintergrund-Polling (Backend Loop):**  
   Das Backend pollt in konfigurierbaren Intervallen (Default: 5 Sekunden) den Endpunkt `POST https://github.com/login/oauth/access_token`.
4. **Fehlerbehandlung während des Pollings:**
   - `authorization_pending`: Regulärer Wartezustand; Polling fortsetzen.
   - `slow_down`: Das Backend erhöht das Polling-Intervall sofort um **mindestens +5 Sekunden** (z. B. von 5s auf 10s), um Ratenbegrenzungen des Providers einzuhalten.
   - `expired_token`: Das 15-minütige Zeitfenster ist abgelaufen. Polling wird beendet; Frontend meldet: *"Kopplungssitzung abgelaufen"*.
   - `access_denied`: Der Anwender hat im Browser auf "Abbrechen" geklickt. Polling wird gestoppt.
5. **Erfolgreicher Abschluss:**  
   Der Provider liefert das Access Token (`gho_...`). Das Backend speichert dieses verschlüsselt im Vault, instanziiert den Endpunkt auf `https://models.github.ai/inference` und schaltet ihn per Hot-Reload scharf.

### 3.3 OAuth 2.0 PKCE Flow (OpenRouter für Universal-Modelle)
Für Plattformen wie OpenRouter, die eine Browser-Weiterleitung verlangen, implementiert das Dashboard den **OAuth 2.0 Authorization Code Flow mit Proof Key for Code Exchange (PKCE, RFC 7636)**:
- Das Backend generiert einen kryptographischen `code_verifier` (43–128 Zeichen Base64URL) und leitet daraus den `code_challenge = SHA256(code_verifier)` ab.
- Das Cockpit öffnet `https://openrouter.ai/auth?callback_url=...&code_challenge=...`.
- Nach Freigabe sendet OpenRouter den Code an den lokalen Callback-Endpunkt `/api/auth/openrouter/callback`.
- Das Backend tauscht den Code unter Vorlage des `code_verifier` gegen einen persistenten User-API-Key (`sk-or-v1-...`) ein und hinterlegt ihn im Vault.

### 3.4 Analyse: OpenAI ChatGPT Plus/Pro vs. Platform API
Ein häufiger Nutzer-Wunsch ist die Nutzung bestehender ChatGPT Plus- oder Pro-Abonnements ($20/$200/Monat) im Bot. Die technische und rechtliche Untersuchung liefert hierzu ein eindeutiges Ergebnis:
- **Geschlossenes Ökosystem:** OpenAI trennt strikt zwischen Endverbraucher-Abonnements (ChatGPT) und der Entwickler-Plattform (`api.openai.com`). "Sign in with ChatGPT" existiert nur für exklusive Großpartner (Notion, Devin).
- **ToS-Verstoß:** Die Extraktion von Web-Session-Tokens (`__Secure-next-auth.session-token`) über Headless-Browser verstößt gegen die OpenAI Nutzungsbedingungen (Abschnitt 3c).
- **Technische Hürde:** Die Web-Endpunkte sind durch **Cloudflare Turnstile** und Browser-Fingerprinting gesichert. Inoffizielle Scraper brechen regelmäßig ab und führen zu Account-Sperren.
- **Empfehlung:** Offizielle Platform-Keys (`sk-proj-...`) bleiben für direkte OpenAI-Nutzung Pflicht. Für kostenlose Spitzenmodelle (inkl. GPT-4o) dient der **GitHub Models Device Flow** als absolut legaler, ToS-konformer und stabiler Ersatz!

### 3.5 Lokale & Self-Hosted Inferenz (Zero-Config Multi-Port-Sweep)
Lokale Modelle garantieren unbegrenzte Voxel-Synthese ohne Internetabhängigkeit und ohne API-Kosten.

#### 1. Multi-Port-Sweep Signaturen
| Server-Typ | Standard-Port | Health / Version Endpoint | Katalog-Endpoint | Typische Signatur |
| :--- | :--- | :--- | :--- | :--- |
| **Ollama** | `11434` | `GET /api/version` | `GET /api/tags` | `{"version": "0.5.x"}` & `{models: [{details: {format: "gguf"}}]}` |
| **LM Studio** | `1234` | `GET /api/v0/health` | `GET /v1/models` | `{"object": "list", "data": [{id: "..."}]}` |
| **vLLM** | `8000` | `GET /health` | `GET /v1/models` | HTTP 200 OK & Prometheus `vllm:num_requests_running` |
| **LocalAI** | `8080` / `5000` | `GET /readyz` | `GET /models` | `{"object": "list"}` |
| **Jan Desktop** | `1337` | `GET /v1/models` | `GET /v1/models` | OpenAI-kompatible Liste geladener Modelle |

#### 2. GPU-VRAM-Offload-Telemetrie via `/api/ps` (Ollama)
Ollama liefert über `GET /api/ps` genaue Zahlen zur GPU-Auslastung geladener Modelle:
$$\text{GPU-Offload \%} = \frac{\text{size\_vram}}{\text{size}} \times 100\%$$
- **100%:** Reines GPU-Inferenz (Optimal, 80–140 Tok/s).
- **1%–99%:** CPU/GPU Split (Akzeptabel, 15–30 Tok/s).
- **0%:** Reiner CPU-Fallback (Kritisch langsam, 1–3 Tok/s -> Warnung im Cockpit!).

#### 3. BFF-Proxy gegen Browser-CORS & Private Network Access (PNA)
Da moderne Browser Anfragen aus dem Dashboard an lokale IP-Adressen (`127.0.0.1:11434`) aufgrund von CORS und W3C PNA blockieren, laufen alle lokalen Probes **ausschließlich serverseitig über das Node.js Express Backend** (`GET /api/endpoints/discover-local`). Node.js unterliegt keinen Browser-Sicherheitsgrenzen.

#### 4. Schutz vor dem Ollama 2048-Token-Limit
Ollama beschränkt Modelle standardmäßig auf winzige **2.048 Tokens Kontext** (`num_ctx: 2048`). Der Minecraft Architect Bot benötigt jedoch für Voxel-Matrizen und Linter-Feedback mindestens 16.384 Tokens. Das Backend erzwingt daher bei allen Ollama-Aufrufen in den Request-Optionen:
```json
{
  "options": {
    "num_ctx": 16384,
    "temperature": 0.2
  }
}
```

### 3.6 Kryptographische Zugangsdaten-Speicherung (DPAPI vs. AES-256-GCM Vault)
- **Evaluation OS Keychain / DPAPI:** Bibliotheken wie `keytar` bieten zwar Zugriff auf den Windows Credential Manager, erfordern jedoch native C++ Compiler (`node-gyp`, Python, MSBuild) und scheitern häufig bei Endanwendern oder in Docker-Containern.
- **SOTA-Wahl: Authenticated Encrypted Local Vault (`data/credentials.vault`)**
  - **100% Zero C++ Dependencies:** Nutzt ausschließlich das native Node.js-Modul `node:crypto`.
  - **Verschlüsselung:** **AES-256-GCM** (Galois/Counter Mode) mit zufälligem 96-Bit IV pro Schreibvorgang und 128-Bit Authentifizierungs-Tag (AEAD).
  - **Schlüsselableitung (KDF):** `crypto.scryptSync(systemSalt, machineMasterKey, 32, { N: 16384, r: 8, p: 1 })`.
  - **Integritätsschutz:** Manipulationen an der Vault-Datei werden beim Entschlüsseln durch das GCM-Auth-Tag sofort erkannt und abgewehrt (`Cipher authentication failed`).

### 3.7 Masked Write-Only Credential Protocol (`sk-...abcd`), gehärtete Maskenerkennung & Frontend-Schutz

#### 1. Der Write-Only Kontrakt & Invariante
Echte API-Keys und OAuth-Tokens werden nach der initialen Erfassung **niemals** an das Browser-Frontend gesendet!
- **REST-Endpunkt `GET /api/endpoints`:** Liefert ausschließlich maskierte Zeichenketten:
  - `"csk_9876543210abcdef1234"` $\rightarrow$ `"csk_...1234"`
  - `"gho_16C7e42F292c69123456789abcdefABCD"` $\rightarrow$ `"gho_...ABCD"`
  - `"sk-proj-abcde1234567890fghij-klmnop1234567890"` $\rightarrow$ `"sk-proj-...7890"`
  - Das Frontend erhält zusätzlich das Bool-Flag `hasSecret: true`.
- **Write-Only Schutz-Invariante:** Lässt der Nutzer beim Editieren im Cockpit das Passwort-Feld leer, übergibt Whitespace, belässt den Platzhalter `••••••••` oder sendet den vom Frontend angezeigten maskierten Platzhalter (z. B. `sk-proj-...-1234`) zurück, greift zwingend die Invariante:
  $$\text{incomingSecret is empty or isMaskedPlaceholder(incomingSecret)} \implies \text{keepExistingSecret} = \text{true}$$
  Das Backend lässt das existierende Secret im verschlüsselten Vault (`credentials.vault`) **vollständig unangetastet**. Nur wenn ein echter, unmaskierter neuer Schlüsselwert übermittelt wird, der die Maskenprüfung nicht erfüllt (`isMaskedPlaceholder === false`), wird der Vault aktualisiert.

#### 2. Gehärtete Maskenerkennung gegen Key-Zerstörung (Adversarial Hardening)
- **Die Verwundbarkeit naiver Masken-Regex:** Frühe Implementierungsentwürfe nutzten naive reguläre Ausdrücke wie `/^[a-z0-9_-]{2,12}\.{3}[a-z0-9]{3,6}$/i`. Wenn moderne API-Keys (z. B. OpenAI Project Keys `sk-proj-...-123` oder OpenRouter Keys `sk-or-v1-...`) Bindestriche, Unterstriche, Base64-Zeichen (`+`, `/`, `=`) oder Punkte im Suffix aufweisen (z. B. Schlüssel, deren Suffix auf `-123` lautet), schlägt die naive Erkennung fehl (`false`). Ein naives Backend würde diesen Platzhalter als vermeintlich neuen Klartext-Key interpretieren und den echten Schlüssel im Tresor permanent mit der Maske überschreiben und vernichten!
- **Gehärtete Prüffunktion (`isMaskedPlaceholder`):**
```javascript
/**
 * Erkennt zuverlässig Masken-Platzhalter jeglicher LLM-Provider.
 * Verhindert das versehentliche Zerstören von Vault-Secrets durch UI-Platzhalter.
 */
function isMaskedPlaceholder(value) {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;

  // 1. Reine Bullet- / Asterisk-Platzhalter (mindestens 3 Zeichen)
  if (/^[•●\*]{3,}$/.test(trimmed)) return true;

  // 2. Gehärtetes Ellipsis-Muster: Unterstützt Präfixe mit Unterstrichen/Bindestrichen (z. B. sk-proj-)
  // sowie Suffixe mit Bindestrichen, Unterstrichen, Punkten, Plus und Gleichheitszeichen
  // Erkennt z. B. "sk-proj-...-123", "gho_16...6912", "csk_...abcd", "...1234"
  if (/^[a-zA-Z0-9_-]{0,16}\.{3}[a-zA-Z0-9_\-\.\+=]{2,8}$/i.test(trimmed)) return true;
  if (/^\.{3}[a-zA-Z0-9_\-\.\+=]{2,8}$/i.test(trimmed)) return true;

  return false;
}
```

#### 3. Sichere Maskierungs-Engine (`maskSecret`)
```javascript
function maskSecret(secret) {
  if (typeof secret !== 'string') return '';
  const trimmed = secret.trim();
  if (trimmed.length === 0) return '';

  // Kurze Secrets (<= 8 Zeichen) niemals teilweise exponieren
  if (trimmed.length <= 8) {
    return '••••••••';
  }

  // Bekannte Provider-Präfixe isolieren (z. B. sk-proj-, sk-or-v1-, gho_, gsk_, csk_)
  const prefixMatch = trimmed.match(/^([a-z0-9_-]{3,12}_)/i) || 
                      trimmed.match(/^(sk-proj-|sk-or-v1-|sk-ant-api\d\d-|sk-)/i);
  const prefix = prefixMatch ? prefixMatch[0] : trimmed.slice(0, 4);
  const suffix = trimmed.slice(-4);

  // Schutz vor Überlappung bei kurzen Strings
  if (prefix.length + suffix.length >= trimmed.length) {
    return `${trimmed.slice(0, 3)}...${suffix}`;
  }

  return `${prefix}...${suffix}`;
}
```

#### 4. Log-Sanitization & Leak-Prävention
Im Server-Logger werden alle Header, Abfrage-URLs und Payloads vor der Ausgabe mit regulären Ausdrücken gefiltert:
- Bearer-Header: `Bearer [REDACTED_TOKEN]`
- JSON-Felder: `apiKey`, `api_key`, `token`, `secret` $\rightarrow$ `"[REDACTED_SECRET]"`
- Erkannte Provider-Muster: `sk-...`, `gho_...`, `gsk_...`, `csk_...` werden automatisch geschwärzt.


---

# 4. Lückenloser Implementierungsplan & Architekturspezifikation (R3)

### 4.1 UI/UX-Architektur & Navigationsintegration im Dashboard

#### 1. Header-Pill Interaktivität
In `src/web/public/index.html` wird die statische Pille `#pillLlmProvider` zu einem interaktiven Steuerelement aufgewertet:
```html
<div id="pillLlmProvider" class="telemetry-pill interactive" title="Klicken, um KI-Modelle & Endpunkte zu konfigurieren">
  <span class="pill-label">LLM:</span>
  <span id="txtActiveLlmName" class="pill-val">Cerebras (llama-3.3-70b)</span>
  <span id="badgeActiveLlmLatency" class="pill-latency-badge good">42ms</span>
  <span class="pill-gear-icon">⚙️</span>
</div>
```
Zusätzlich wird in der Header-Navigationsleiste ein eigenständiger Button `<button id="btnOpenModelSettings" class="btn btn-secondary btn-sm">⚙️ Endpunkte</button>` integriert.

#### 2. Full-Screen CAD Overlay (`#modalModelSettings`)
Das Modal schiebt sich bei Klick mit einem animierten Backdrop-Blur über das 3D-CAD-Dashboard (`z-index: 1000; background: rgba(10, 14, 20, 0.88); backdrop-filter: blur(10px)`).

#### 3. Die 4 Visuellen Zonen der Einstellungsseite
```
+==================================================================================================+
|  ⚙️ MODELLENDPUNKT- & KI-VERBINDUNGS-COCKPIT                           [+ Neuer Endpunkt] [✕]    |
+==================================================================================================+
|  [ZONE 1: GLOBAL MODEL STATUS & TIER ASSIGNMENT]                                                |
|  Fast Tier (Chat & Quick Loops):       [ Cerebras (llama-3.3-70b) 48ms  ▼ ]  Status: 🟢 Bereit   |
|  Architect Tier (CAD & Code Synthese): [ Codestral (codestral-2501) 310ms ▼ ]  Status: 🟢 Bereit  |
|  [x] Schlüsselloser Notfall-Fallback (Kilo AI / LLM7 Gateway aktiv)                             |
+--------------------------------------------------------------------------------------------------+
|  [ZONE 2: ZERO-CONFIG LOCAL MODEL AUTO-DETECTOR]                                                 |
|  [ 🔍 Lokale Inferenz-Server suchen (Ollama / LM Studio / vLLM) ]  Scanner: Idle                 |
|  Gefundene lokale Instanzen:                                                                    |
|  • Ollama (Port 11434): 🟢 Online (v0.5.2) | 3 Modelle | GPU VRAM: 100% [qwen2.5-coder:14b]      |
|    [ Als Architect Tier zuweisen ] [ Details ]                                                  |
+--------------------------------------------------------------------------------------------------+
|  [ZONE 3: PROVIDER OVERVIEW CARDS GRID]                                                          |
|  +--------------------+ +--------------------+ +--------------------+ +--------------------+    |
|  | 🐙 GitHub Models   | | 🌐 OpenRouter      | | 🦙 Ollama (Lokal)  | | ⚡ Cerebras Cloud  |    |
|  | [1-Click Device]   | | [OAuth PKCE]       | | [Auto-Detected]    | | [API Key]          |    |
|  | GPT-4o / Llama 3.3 | | 30+ Free Models    | | qwen2.5-coder:14b  | | llama-3.3-70b      |    |
|  | 🟢 Verbunden (84ms)| | 🟢 Verbunden(220ms)| | 🟢 GPU 100% (28ms) | | 🟢 Online (48ms)   |    |
|  | [Test] [Konfig]    | | [Test] [Konfig]    | | [Test] [Konfig]    | | [Test] [Konfig]    |    |
|  +--------------------+ +--------------------+ +--------------------+ +--------------------+    |
|  +--------------------+ +--------------------+ +--------------------+ +--------------------+    |
|  | 🚀 GroqCloud LPU   | | 🌪️ Mistral/Codestr.| | 💎 Google Gemini   | | 🔌 Custom OpenAI   |    |
|  | [API Key]          | | [API Key]          | | [API Key]          | | [BaseURL + Key]    |    |
|  | llama-3.3-70b-vers | | codestral-2501     | | gemini-2.5-flash   | | vLLM / LocalAI     |    |
|  | 🟢 Online (65ms)   | | 🟢 Online (310ms)  | | 🟢 Quota: 92% frei | | ⚪ Standby         |    |
|  | [Test] [Konfig]    | | [Test] [Konfig]    | | [Test] [Konfig]    | | [Test] [Konfig]    |    |
|  +--------------------+ +--------------------+ +--------------------+ +--------------------+    |
+--------------------------------------------------------------------------------------------------+
|  [ZONE 4: LIVE HEALTH & LATENCY MONITOR]                                                         |
|  • Letzter Router-Aufruf: Cerebras Cloud (48ms RTT) | Erfolgsrate: 100% | Quoten-Puffer: OK      |
+==================================================================================================+
```

---

### 4.2 Schrittweiser Ablauf der Verbindungseinrichtung

#### Flow A: 1-Click Device Authorization Flow (GitHub Models)
```
[User klickt "Mit GitHub verbinden"]
         |
         v
Frontend sendet POST /api/auth/device-flow/start
         |
Backend ruft GitHub POST /login/device/code auf ({ client_id, scope: "read:user" })
         |
Backend erhält { device_code, user_code: "WDJB-WQWD", verification_uri_complete, interval: 5 }
         |
Frontend zeigt Modal mit User-Code, QR-Code, 15-Minuten Countdown & Button "↗ GitHub öffnen"
Backend startet Polling-Worker (alle 5s POST /login/oauth/access_token)
         |
         +--> [Antwort: 400 authorization_pending] --> Warte 5 Sekunden
         +--> [Antwort: 400 slow_down] ----------> Erhöhe Intervall: interval += 5s
         +--> [Antwort: 400 expired_token] ------> UI-Meldung: "Zeitfenster abgelaufen"
         |
[User bestätigt WDJB-WQWD im Browser auf github.com]
         |
Backend empfängt HTTP 200 { access_token: "gho_..." }
Backend speichert Token im AES-256-GCM Vault
Backend instanziiert Endpunkt auf https://models.github.ai/inference
Backend sendet WebSocket: { type: "device_auth_success", provider: "GitHub", model: "openai/gpt-4o" }
UI schaltet Karte auf 🟢 Verbunden und aktualisiert Header-Pill!
```

#### Flow B: OAuth 2.0 PKCE Flow (OpenRouter)
1. Nutzer klickt auf `"Mit OpenRouter verbinden"`.
2. Backend generiert `code_verifier` und `code_challenge` und gibt die Auth-URL zurück.
3. Frontend öffnet Popup mit OpenRouter Autorisierungsdialog.
4. Nach Bestätigung leitet OpenRouter an `/api/auth/openrouter/callback?code=...` weiter.
5. Backend tauscht Code gegen persistenten User-API-Key (`sk-or-v1-...`) ein und sichert ihn im Vault.

#### Flow C: Manueller API Key & Custom Configuration
1. Nutzer öffnet Slide-Over Drawer `"Neuer Endpunkt"`.
2. Auswahl des Providers (z. B. "Cerebras Cloud" oder "Custom OpenAI Proxy").
3. Eingabe von `Base-URL`, `API-Key` (Write-Only Passwortfeld mit `👁`-Toggle) und `Modell-ID`.
4. Klick auf `[ Verbindung testen ]`:
   - Backend führt Safe Probe aus (Metadaten + 1-Token Ping).
   - Bei Erfolg: Anzeige der Latenz (z. B. `48ms`) und Quoten-Puffer.
5. Klick auf `[ Speichern & Aktivieren ]`: Endpunkt landet im Vault und wird sofort im Pool aktiviert.

#### Flow D: Lokale Server Auto-Erkennung
1. Nutzer klickt in Zone 2 auf `[ 🔍 Lokale Inferenz-Server suchen ]`.
2. Backend-Sweep tastet Ports 11434, 1234, 8000, 8080, 1337 ab.
3. Gefundene Server werden als Info-Karten gelistet inkl. Version, Modellkatalog und GPU-VRAM-Offload-Prozentsatz.
4. Nutzer wählt sein lokales Wunschmodell (z. B. `qwen2.5-coder:14b`) und klickt `[ Als Architect Tier zuweisen ]`.
5. Fertig — der Bot nutzt sofort das lokale Modell ohne weiteren Konfigurationsaufwand!

---

### 4.3 Exaktes Daten- und Speichermodell

#### 1. TypeScript-Typdefinitionen (`src/types/endpoints.ts` bzw. JSDoc-Schemas)
```typescript
export type AuthType = 'none' | 'api_key' | 'oauth_device_flow' | 'oauth_pkce' | 'bearer_token';
export type EndpointTier = 'FAST_TIER' | 'ARCHITECT_TIER' | 'REASONING_TIER' | 'FALLBACK_POOL';
export type EndpointCategory = 'cloud' | 'local' | 'gateway';
export type EndpointHealthStatus = 'healthy' | 'degraded' | 'cooldown' | 'unauthorized' | 'offline' | 'untested';

export interface EndpointConfiguration {
  id: string;                          // Eindeutige ID (z. B. "ep_github_models_1")
  name: string;                        // Anzeigename (z. B. "GitHub Models (GPT-4o)")
  provider: string;                    // "GitHub" | "OpenRouter" | "Ollama" | "Cerebras" | "Groq" | ...
  category: EndpointCategory;          // "cloud" | "local" | "gateway"
  tier: EndpointTier;                  // Rollenzuweisung im Bot
  enabled: boolean;                    // Aktiv-Schalter
  priority: number;                    // Prioritäts-Rangfolge (1 = primär)
  
  // Routing & Verbindung
  baseUrl: string;                     // OpenAI-kompatible Basis-URL
  modelId: string;                     // Exakter Modellbezeichner
  authType: AuthType;                  // Authentifizierungsart
  credentialRef: string;               // Schlüsselreferenz im Vault (z. B. "sec_gh_models")
  organizationId?: string;             // Optional für OpenAI Orgs
  customHeaders?: Record<string, string>; // Zusätzliche HTTP-Header
  
  // Sampler-Parameter & Kontext
  temperature: number;                 // Standard: 0.2
  topP?: number;                       // Standard: 1.0
  maxTokens: number;                   // Standard: 4000
  contextWindow: number;               // Tokenfenster (z. B. 16384 für Ollama, 128000 für GPT-4o)
  systemPromptOverrides?: string;      // Optionale systemspezifische Prompt-Erweiterungen
  
  // Hardware-Details lokaler Server
  localDetails?: {
    engine: 'ollama' | 'lmstudio' | 'vllm' | 'localai' | 'jan';
    port: number;
    vramOffloadPercentage?: number;    // 0 bis 100%
    quantization?: string;             // z. B. "Q4_K_M"
  };

  // Maskierte Sicht für das Web-UI (Write-Only)
  maskedSecret?: string;               // z. B. "gho_16...6912"
  hasSecret?: boolean;                 // true wenn Secret im Vault existiert
  isSystemDefault?: boolean;           // true wenn aus .env importiert
}

export interface EncryptedVaultFile {
  version: number;                     // 1
  kdf: 'scrypt';
  cipher: 'aes-256-gcm';
  salt: string;                        // 32 Bytes Hex
  iv: string;                          // 12 Bytes Hex
  tag: string;                         // 16 Bytes Hex GCM Auth-Tag
  ciphertext: string;                  // Hex-codierte verschlüsselte JSON-Nutzlast
}

export interface DecryptedVaultPayload {
  updatedAt: string;
  secrets: Record<string, {
    type: AuthType;
    provider: string;
    token: string;
    expiresAt?: string | null;
  }>;
}
```

#### 2. Hybrid-Speichermodell & Write-Only Invariante
- **Metadaten (`data/endpoints.json`):** Enthält alle nicht-sensiblen Konfigurationen, Modell-IDs, Prioritäten und maskierte Vorschauen (`maskedSecret`).
- **Verschlüsselter Tresor (`data/credentials.vault`):** Enthält die unmaskierten Tokens, verschlüsselt mit AES-256-GCM. Der Masterkey wird on-the-fly aus der Host-Machine-ID (`os.hostname() + os.userInfo().username`) und dem System-Salt abgeleitet (mit optionalem Fallback auf `VAULT_MASTER_KEY` für containerisierte Umgebungen).
- **Write-Only Schutz-Invariante in `EndpointManager.updateEndpoint(id, updates)`:**
  Beim Aktualisieren eines Endpunkts über die API oder das Cockpit prüft der `EndpointManager` den eingehenden `secret`-Parameter:
  ```javascript
  // Write-Only Schutz-Invariante in src/ai/endpointManager.js
  async updateEndpoint(id, payload) {
    const existing = this.getEndpoint(id);
    if (!existing) throw new Error(`Endpunkt '${id}' nicht gefunden.`);

    let credentialRef = existing.credentialRef;
    const candidate = payload.secret;

    // Invariante: Wenn secret undefined, leer oder ein Masken-Platzhalter ist (z. B. "sk-proj-...-123", "••••••••")
    // bleibt das bestehende Vault-Secret unberührt erhalten!
    const isPlaceholder = !candidate || 
                          candidate.trim().length === 0 || 
                          this.isMaskedPlaceholder(candidate);

    if (isPlaceholder) {
      this.logger.debug(`Secret für '${id}' bleibt unverändert im Vault (Maske oder leer übergeben).`);
    } else {
      // Echtes neues Secret im verschlüsselten Vault speichern
      credentialRef = await this.vault.storeSecret(id, {
        type: payload.authType || existing.authType,
        provider: payload.provider || existing.provider,
        token: candidate.trim()
      });
    }

    // Metadaten aktualisieren (nur maskiertes Secret in endpoints.json ablegen)
    const updatedConfig = {
      ...existing,
      ...payload,
      credentialRef,
      hasSecret: !!credentialRef,
      maskedSecret: this.maskSecret(candidate && !isPlaceholder ? candidate : (existing.maskedSecret || ''))
    };
    delete updatedConfig.secret; // Niemals Klartext-Secret in Metadaten speichern

    await this.saveEndpointMetadata(updatedConfig);
    return updatedConfig;
  }
  ```

#### 3. Hot-Reload Event-Bus mit FIFO Async Mutex Queue (`llmRouter.reloadPools()`)

##### Das Race-Condition-Problem (Adversarial Interleaving Hazard):
Beim Auslesen von Credentials aus dem verschlüsselten Vault (`credentials.vault`) fallen asynchrone Datei-I/O und Entschlüsselungsoperationen mit variabler Laufzeit an. Wenn ein Anwender im Cockpit schnell hintereinander Einstellungen speichert oder zwei Endpunkt-Aktivierungen parallel erfolgen, können zwei Reload-Aufrufe zeitlich überlappen:
- Reload 1 (langsame Vault-Entschlüsselung, z. B. 40 ms)
- Reload 2 (schneller Cache-Hit / Memory-Reload, z. B. 5 ms)
Ohne Serialisierung würde Reload 2 zuerst abschließen, gefolgt von Reload 1, wodurch der veraltete Zustand von Reload 1 den neueren Zustand von Reload 2 überschreibt (Out-of-Order Overwrite).

##### Die Lösung: FIFO Promise-Serialization-Queue (Async Mutex):
Der `LLMRouter` verwaltet eine interne Promise-Kette `this._reloadQueue`. Jeder Aufruf von `reloadPools()` wird atomar an diese Kette angehängt (`this._reloadQueue = (this._reloadQueue || Promise.resolve()).then(...)`). Dadurch ist mathematisch garantiert, dass alle asynchronen Reloads strikt sequentiell in der Reihenfolge ihres Eintreffens aufgelöst werden:

```javascript
// Serialisierter Hot-Reload via FIFO Promise-Queue in src/ai/llmRouter.js
class LLMRouter {
  constructor(...) {
    // ...
    // FIFO Async Mutex Queue für atomare Pool-Updates
    this._reloadQueue = Promise.resolve();
  }

  /**
   * Serialisierter Hot-Reload der Provider-Pools ohne Downtime.
   * Garantiert strikte FIFO-Abarbeitung und verhindert Out-of-Order Race Conditions.
   */
  reloadPools(endpointManager) {
    this._reloadQueue = (this._reloadQueue || Promise.resolve()).then(async () => {
      const configs = endpointManager.getAllEnabledEndpoints();
      const newFast = [];
      const newArchitect = [];

      for (const config of configs) {
        const rawSecret = await endpointManager.getSecretForRef(config.credentialRef);
        const endpoint = new DynamicEndpoint({
          ...config,
          apiKey: rawSecret
        });
        if (config.tier === 'FAST_TIER') newFast.push(endpoint);
        if (config.tier === 'ARCHITECT_TIER') newArchitect.push(endpoint);
      }

      // Atomarer Austausch der Pools im Speicher (Pointer Swap)
      this.fastEndpoints = newFast;
      this.architectEndpoints = newArchitect;
      this.logger.info(`LLM Router Pools neu geladen: ${newFast.length} Fast, ${newArchitect.length} Architect Endpoints aktiv.`);
    }).catch(err => {
      this.logger.error(`Fehler beim Neuladen der LLM Router Pools: ${err.message}`);
      throw err;
    });

    return this._reloadQueue;
  }
}
```

##### Concurrency- und Zero-Downtime-Garantie:
- **In-Flight Isolation:** Da die Router-Methode `executeRequest` bei Beginn eine flache Kopie der Kandidatenliste erstellt (`const candidates = [...this.getEndpointsForTier(tier)]`), greifen alle während eines Reloads laufenden Anfragen sicher auf die Instanzen ihrer Erzeugung zu. Kein einziger Request wird abgebrochen oder fällt in einen undefinierten Zustand (empirisch verifiziert mit 200 parallelen In-Flight-Requests über 3 Reload-Zyklen).
- **Sofortige Wirksamkeit:** Unmittelbar nach Abschluss des Pointer-Swaps greifen alle nachfolgenden Prompts auf die neuen Endpunkte zu. Laufende Bauaufträge in `worldExecutor.js` laufen unterbrechungsfrei weiter.

---

### 4.4 Verbindungsprüfung: Two-Tier Safe Probe

Der Safe-Probe-Worker validiert Endpunkte vor der Aktivierung auf Ausfallsicherheit:

```
[ POST /api/endpoints/:id/test ]
              |
              v
[Phase 1: Zero-Cost Metadaten Probe]
GET {baseUrl}/models mit Authorization: Bearer {apiKey} (Timeout: 1.500 ms)
              |
              +--> [HTTP 401 Unauthorized] -----> Sofortiger Abbruch: "API-Key ungültig"
              +--> [ECONNREFUSED] --------------> Sofortiger Abbruch: "Server offline"
              +--> [HTTP 200 OK] ---------------> Extrahiere verfügbaren Modellkatalog
              |
              v
[Phase 2: Minimaler 1-Token Ping]
POST {baseUrl}/chat/completions mit { model, messages: [{role: "user", content: "1"}], max_tokens: 1 }
Start Timer (performance.now())
              |
              v
Empfange HTTP 200 OK + Parse Headers
Stopp Timer -> Berechne Latenz RTT in Millisekunden
Extrahiere Quoten-Header (x-ratelimit-remaining-requests, retry-after)
              |
              v
JSON-Ergebnis an UI: { success: true, latencyMs: 48, status: "healthy", quotaRemaining: 850 }
```

#### Sonderbehandlung für lokale Modelle & Thinking-Modelle:
1. **Ollama Cold Starts:** Erkennt der Worker ein lokales Ziel (`127.0.0.1`), wird das Timeout für Phase 2 auf **90 Sekunden** erhöht, da das Laden großer GGUF-Weights in den VRAM bis zu einer Minute dauern kann. Über WebSocket wird der Zwischenstatus `"Lade Modell in den VRAM..."` gemeldet.
2. **Reasoning-Modelle (DeepSeek R1 / gpt-oss):** Thinking-Modelle generieren Mindest-Denktokens. Für diese Modelle setzt der Worker `max_tokens: 50` statt `max_tokens: 1`, um Validierungsfehler durch Token-Truncation zu vermeiden.

---

### 4.5 Fehler-Taxonomie & UX-Feedback-Matrix

| Status Code / Fehler | Ursache / Diagnose | Interne Router-Aktion | Konkrete Handlungsempfehlung für den Anwender im Cockpit |
| :--- | :--- | :--- | :--- |
| **HTTP 401 Unauthorized** | API-Schlüssel falsch, abgelaufen oder gelöscht. | Endpunkt sofort deaktivieren (`disabled = true`). | *"API-Schlüssel ungültig oder abgelaufen. Bitte prüfe den Schlüssel in der Provider-Konsole und trage ihn im Einstellungs-Drawer neu ein."* |
| **HTTP 403 Forbidden** | Modellberechtigung fehlt (z. B. Bezahlmodell im Free-Tier) oder Region blockiert. | Endpunkt deaktivieren (`disabled = true`). | *"Zugriff verweigert (HTTP 403). Dein Account hat keine Berechtigung für dieses Modell. Wähle ein freies Modell oder hinterlege Zahlungsdaten."* |
| **HTTP 404 Not Found** | Modellbezeichner falsch geschrieben oder veralteter Name. | Endpunkt deaktivieren. | *"Modell nicht gefunden (HTTP 404). Bitte klicke auf 'Verfügbare Modelle abrufen' und wähle die exakte Modell-ID aus der Liste."* |
| **HTTP 429 Rate Limit (RPM/TPM)** | Kurzzeitiges Ratenlimit erreicht. Header `retry-after` vorhanden. | Temporärer Cooldown (`cooldownUntil`). Sofortiges Failover auf nächsten Provider (< 20 ms). | *"Kurzzeitiges Rate-Limit erreicht. Bot schaltet automatisch auf Backup-Provider um. Endpunkt wird in X Sekunden reaktiviert."* |
| **HTTP 429 Insufficient Quota** | Monatskontingent oder Guthaben vollständig aufgebraucht (`"insufficient_quota"`). | Endpunkt für 24 Stunden bzw. bis zum manuellen Re-Test sperren. | *"Guthaben aufgebraucht (HTTP 429 Insufficient Quota). Bitte lade Credits auf oder aktiviere das kostenlose GitHub Models Kontingent."* |
| **HTTP 500 / 502 / 503** | Provider-Server überlastet oder Rechenzentrumsausfall. | Kurzer Cooldown (30–60s). Automatisches Failover. Circuit-Breaker nach 3 Fehlern. | *"Provider meldet Serverfehler (HTTP 503). Mögliche Wartung oder Überlastung. Bot nutzt temporär alternative Endpunkte."* |
| **ECONNREFUSED** | Lokaler Server (Ollama / LM Studio) läuft nicht oder Port falsch. | Lokalen Endpunkt auf Status "Offline" setzen. | *"Verbindung verweigert auf Port X. Bitte stelle sicher, dass Ollama (`ollama serve`) oder LM Studio gestartet ist."* |
| **ETIMEDOUT / Timeout** | Netzwerkblockade, Firewall oder extrem langer Cold Start. | Warnung ausgeben; bei Port-Scan Port als inaktiv markieren. | *"Verbindung überschritt das Zeitlimit (Timeout). Wenn ein großes lokales Modell geladen wird, warte 30 Sekunden und teste erneut."* |

---

### 4.6 REST-API & WebSocket Wire-Protokoll-Spezifikation

#### 1. REST-Routen (`src/web/dashboardServer.js`)

##### A. Endpunkt-Management (CRUD)
- `GET /api/endpoints`  
  Liefert alle konfigurierten Endpunkte mit maskierten Secrets (`"csk_98...1234"`), Health-Status und Latenzen.
- `POST /api/endpoints`  
  Erstellt neuen Endpunkt. Payload: `{ endpoint: EndpointConfiguration, secret?: string }`. Speichert Secret im Vault und aktualisiert Metadaten.
- `PUT /api/endpoints/:id`  
  Aktualisiert Endpunkt. Wenn `secret` nicht gesetzt oder maskiert ist, bleibt das alte Secret im Vault erhalten (`keepExistingSecret: true`).
- `DELETE /api/endpoints/:id`  
  Löscht Endpunkt und zugehöriges Vault-Secret.

##### B. Verbindungsprüfung (Safe Probe)
- `POST /api/endpoints/:id/test`  
  Führt Two-Tier Safe Probe für einen gespeicherten Endpunkt aus.
- `POST /api/endpoints/test-adhoc`  
  Testet ungespeicherte Verbindungsdaten direkt aus dem UI-Formular. Payload: `{ baseUrl, modelId, authType, secret }`.

##### C. Lokale Modell-Erkennung
- `GET /api/endpoints/discover-local`  
  Scannt Ports 11434, 1234, 8000, 8080, 1337 via Node.js BFF-Proxy. Liefert gefundene Instanzen, Modellkataloge und GPU-VRAM-Offload-Prozente zurück.

##### D. 1-Click Device Flow (RFC 8628)
- `POST /api/auth/device-flow/start`  
  Startet GitHub Device Flow. Response: `{ sessionId, userCode: "WDJB-WQWD", verificationUriComplete: "https://github.com/login/device?user_code=WDJB-WQWD", expiresIn: 900, interval: 5 }`.
- `GET /api/auth/device-flow/status/:sessionId`  
  Pollt Status: `{ status: "pending" | "success" | "expired" | "denied", endpointId?: string }`.

##### E. Primär-Aktivierung
- `POST /api/endpoints/activate`  
  Weist einem Tier einen Endpunkt zu: `{ tier: "FAST_TIER" | "ARCHITECT_TIER", endpointId: string }`. Löst `llmRouter.reloadPools()` aus.

#### 2. WebSocket-Events (`dashboardServer.js` $\leftrightarrow$ `app.js`)
- `endpoint_status_change`: Informiert den Browser in Echtzeit über Statusänderungen (z. B. 429 Cooldown oder erfolgreiche Reaktivierung).
- `probe_progress`: Sendet Live-Fortschritt bei langsamen Tests (z. B. Cold Starts).

---

### 4.7 Phasen-, Migrations- und Rollout-Plan

Die Umsetzung erfolgt in 5 aufeinander aufbauenden Phasen nach dem Minimal-Change- und Zero-Regression-Prinzip:

```
+---------------------------------------------------------------------------------+
| PHASE 1: Tresor & Datenhaltung (Zero Dependencies)                              |
| • src/security/credentialVault.js (AES-256-GCM + Scrypt KDF)                   |
| • src/ai/endpointManager.js (Metadaten-Verwaltung, .env-Import, CRUD)          |
| • test/credentialVaultTest.js (Unit-Tests für Verschlüsselung & Auth-Tag)       |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
| PHASE 2: Safe-Probe Worker & REST-Routen (BFF Layer)                            |
| • src/ai/safeProbeWorker.js (Two-Tier Probe, Latenz, Quoten-Header, Cold-Starts)|
| • src/security/deviceFlowManager.js (RFC 8628 GitHub Polling Loop, slow_down)  |
| • src/web/dashboardServer.js (Neue REST-Routen /api/endpoints/*, BFF-Proxy)   |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
| PHASE 3: Router Hot-Reload & Dynamic Endpoints                                  |
| • src/ai/llmRouter.js (DynamicEndpoint, reloadPools(), Request-Timeout 30s)    |
| • Integration mit architectAgent.js & chatController.js                         |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
| PHASE 4: UI/UX Dashboard Cockpit Integration                                    |
| • src/web/public/index.html (Header-Pill interaktiv, Modal #modalModelSettings) |
| • src/web/public/style.css (Dark CAD Styling, Provider-Grid, Badges, Animation) |
| • src/web/public/app.js (Modal-Controller, Safe-Probe-Trigger, Device-Flow UX)  |
+---------------------------------------------------------------------------------+
                                       |
                                       v
+---------------------------------------------------------------------------------+
| PHASE 5: Vollständige Test-Suite & Regressionsprüfung                           |
| • test/modelConnectionTest.js (Mocks für Device Flow, AES-Vault, Safe Probe)   |
| • Ausführung der gesamten Testsuite (`npm test`) -> 100% PASS                   |
+---------------------------------------------------------------------------------+
```

#### Detaillierte Datei-Änderungsmatrix:
| Datei | Status | Änderungen & Zweck |
| :--- | :--- | :--- |
| `src/security/credentialVault.js` | **NEU** | Verschlüsselter Speicher für API-Keys & Tokens (`AES-256-GCM`, `scrypt`). |
| `src/security/deviceFlowManager.js` | **NEU** | RFC 8628 Device Authorization Flow Controller (GitHub Models, Polling, `slow_down`). |
| `src/ai/endpointManager.js` | **NEU** | Verwaltung von `data/endpoints.json`, Verschmelzung mit `.env`-Defaults. |
| `src/ai/safeProbeWorker.js` | **NEU** | Zweistufige Validierung (Zero-Cost Metadaten `/models` + 1-Token Ping), Latenzmessung. |
| `src/ai/llmRouter.js` | **MODIFIZIERT** | Einbau von `DynamicEndpoint`, `reloadPools()` Hot-Reload-Methode, Hinzufügen von `timeout: 30000` im Client. |
| `src/web/dashboardServer.js` | **MODIFIZIERT** | Registrierung aller neuen `/api/endpoints/*` und `/api/auth/*` REST-Routen und WebSocket-Events. |
| `src/web/public/index.html` | **MODIFIZIERT** | Interaktive Header-Pill `#pillLlmProvider`, Einstellungs-Modal `#modalModelSettings`, Drawer. |
| `src/web/public/style.css` | **MODIFIZIERT** | Dark CAD Styling für Modal, Provider-Cards, Latency-Pillen und QR-Code-Container. |
| `src/web/public/app.js` | **MODIFIZIERT** | Event-Handling für Modal, Device-Code Countdown-Timer, Ad-hoc Verbindungsprüfungen. |
| `test/modelConnectionTest.js` | **NEU** | 100% Offline-Unit- und Integrationstests für Vault, Safe-Probe und Device-Flow Mocking. |

#### Rollback- & Migrationsstrategie:
- **Volle Abwärtskompatibilität:** Existiert noch keine `data/credentials.vault` oder `data/endpoints.json`, liest der `EndpointManager` automatisch alle bestehenden `.env`-Schlüssel ein und markiert sie als unveränderbare System-Defaults.
- **Graceful Fallback:** Schlägt die Entschlüsselung des Vaults fehl (z. B. verändertes System-Salt), stürzt der Bot nicht ab, sondern fällt automatisch auf die bewährten statischen `.env`-Endpunkte und Zero-Key-Gateways (Kilo AI / LLM7) zurück und zeigt im Dashboard ein Reparatur-Banner an.
- **Rollback-Fähigkeit:** Alle Änderungen an `llmRouter.js` und `dashboardServer.js` sind additiv gestaltet, sodass bestehende Subsysteme (`architectAgent`, `chatController`, `worldExecutor`) ohne Verhaltensänderung weiterarbeiten.

---

*Ende des Implementierungsplans `IMPLEMENTIERUNGSPLAN_MODELLVERBINDUNGEN.md`.*
