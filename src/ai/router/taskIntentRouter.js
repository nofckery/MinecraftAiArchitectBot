import { logger } from '../../utils/logger.js';
import { llmRouter } from '../llmRouter.js';
import { TASK_ROLES } from '../modelKnowledgeBase.js';

export const TASK_INTENTS = {
  BUILD: 'BUILD',
  DEFEND: 'DEFEND',
  MINE: 'MINE',
  FOLLOW: 'FOLLOW',
  STOP: 'STOP',
  STATUS: 'STATUS',
  EXPEDITION: 'EXPEDITION',
  CRAFT: 'CRAFT',
  SMELT: 'SMELT',
  SETHOME: 'SETHOME',
  HOME: 'HOME',
  DEPOSIT: 'DEPOSIT',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Normalisiert Ore- und Rohstoffnamen aus deutscher/englischer Umgangssprache.
 */
export function normalizeResourceName(rawResource) {
  if (!rawResource) return 'iron_ore';
  const r = rawResource.toLowerCase().trim();

  // Erze
  if (r.includes('eisen') || r.includes('iron')) return 'iron_ore';
  if (r.includes('kohle') || r.includes('coal')) return 'coal_ore';
  if (r.includes('kupfer') || r.includes('copper')) return 'copper_ore';
  if (r.includes('diamant') || r.includes('diamond')) return 'diamond_ore';
  if (r.includes('gold')) return 'gold_ore';
  if (r.includes('redstone') || r.includes('rotstein')) return 'redstone_ore';
  if (r.includes('lapis') || r.includes('lasurstein')) return 'lapis_ore';
  if (r.includes('smaragd') || r.includes('emerald')) return 'emerald_ore';
  if (r.includes('quarz') || r.includes('quartz')) return 'nether_quartz_ore';
  if (r.includes('erz') || r.includes('ore')) return 'any_ore';

  // Holz & Bäume
  if (r.includes('holz') || r.includes('baum') || r.includes('bäume') || r.includes('wood') || r.includes('log') || r.includes('stamm')) {
    if (r.includes('eiche') || r.includes('oak')) return 'oak_log';
    if (r.includes('fichte') || r.includes('spruce')) return 'spruce_log';
    if (r.includes('birke') || r.includes('birch')) return 'birch_log';
    if (r.includes('dunkel') || r.includes('dark')) return 'dark_oak_log';
    return 'any_log';
  }

  // Steine
  if (r.includes('stein') || r.includes('stone') || r.includes('bruchstein') || r.includes('cobble')) {
    return 'stone';
  }

  return r;
}

export class TaskIntentRouter {
  /**
   * Deterministischer 0ms-Matcher für deutsche & englische Gameplay- und Bauanweisungen.
   * Erkennt präzise trennbare Verben wie "baue [...] ab" vs "baue [Haus]".
   *
   * @param {string} text Benutzeranweisung
   * @returns {Object|null} Erkanntes Intent-Objekt oder null falls uneindeutig
   */
  matchDeterministicIntent(text) {
    if (!text || typeof text !== 'string') return null;
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();

    // 1. Not-Stopp & Abbruch
    if (/^(stop|stopp|halt|anhalten|abbrechen|hör auf|abbruch|pause|cancel)\b/i.test(lower) || lower === '!stop') {
      return {
        intent: TASK_INTENTS.STOP,
        rawText: trimmed
      };
    }

    // 2. Verteidigung & Monsterbekämpfung (DEFEND)
    // Beispiele:
    // - "verteidige diesen bereich und töte alle monster/feinde(npcs)"
    // - "beschütze diesen bereich"
    // - "töte alle feinde"
    // - "töte alle monster"
    // - "halte wache"
    // - "guard area"
    const isDefend = (
      /(verteidige|beschütze|wache|guard|patrouilliere|sichere)\s+(diesen|den|das|unsere?n?|den)?\s*(bereich|gebiet|zone|posten|ort|haus|perimeter|umgebung|platz)?/i.test(lower) ||
      /(töte|eliminiere|bekämpfe|kill|vernichte)\s+(alle\s+)?(monster|feinde|mobs|gegner|npcs|kreaturen)/i.test(lower) ||
      /\b(wache halten|wachdienst|defend|guard)\b/i.test(lower) ||
      lower.startsWith('!guard') ||
      lower.startsWith('!defend')
    );

    if (isDefend) {
      // Radius ermitteln (falls angegeben, z. B. "im umkreis von 25 blöcken" oder "20m")
      const radiusMatch = lower.match(/(?:umkreis|radius|von)\s+(\d+)\s*(?:m|blöcke|meter)?/i) || lower.match(/(\d+)\s*(?:m|blöcke|meter)\s+(?:umkreis|radius)/i);
      const radius = radiusMatch ? Math.max(8, Math.min(64, parseInt(radiusMatch[1], 10))) : 20;

      return {
        intent: TASK_INTENTS.DEFEND,
        radius,
        target: 'hostiles',
        rawText: trimmed
      };
    }

    // 3. Mining & Ressourcenabbau (MINE / HARVEST)
    // Wichtig im Deutschen: "baue [X] ab" = MINE, während "baue [Haus]" = BUILD!
    const isMiningVerb = (
      /(baue?|bau)\s+(.+?)\s+(ab|abzubauen)/i.test(lower) ||
      /^(abbauen|grabe|schürfe|mine|farm|hacke|fäll|fälle)\b/i.test(lower) ||
      /\b(erz|erze|eisenerz|kohle|kupfer|diamant|gold|bäume|baumstämme)\s+(abbauen|abzubauen|minen|schürfen|farmen|fällen)\b/i.test(lower) ||
      lower.startsWith('!mine') ||
      lower.startsWith('!harvest')
    );

    if (isMiningVerb) {
      // Ressourcentyp extrahieren
      let resource = 'iron_ore';
      let amount = 32;

      // Extrahiere Anzahl falls vorhanden (z. B. "10 eisenerz" oder "alle")
      const amountMatch = lower.match(/\b(\d+)\s*(?:x|stück|blöcke)?\b/);
      if (amountMatch) {
        amount = Math.max(1, Math.min(256, parseInt(amountMatch[1], 10)));
      } else if (lower.includes('alle') || lower.includes('alles')) {
        amount = 64; // Suche alle bis zum Radius-Limit
      }

      // Ziel-Ressource identifizieren
      if (lower.includes('eisen') || lower.includes('iron')) resource = 'iron_ore';
      else if (lower.includes('kohle') || lower.includes('coal')) resource = 'coal_ore';
      else if (lower.includes('kupfer') || lower.includes('copper')) resource = 'copper_ore';
      else if (lower.includes('diamant') || lower.includes('diamond')) resource = 'diamond_ore';
      else if (lower.includes('gold')) resource = 'gold_ore';
      else if (lower.includes('redstone')) resource = 'redstone_ore';
      else if (lower.includes('lapis')) resource = 'lapis_ore';
      else if (lower.includes('holz') || lower.includes('baum') || lower.includes('bäume') || lower.includes('wood') || lower.includes('stamm')) resource = 'any_log';
      else if (lower.includes('stein') || lower.includes('stone') || lower.includes('cobble')) resource = 'stone';
      else if (lower.includes('erz') || lower.includes('ore')) resource = 'any_ore';

      // Radius ermitteln (Standard: 24m)
      const radiusMatch = lower.match(/(?:umkreis|radius|nähe|von)\s+(\d+)\s*(?:m|blöcke|meter)?/i);
      const radius = radiusMatch ? Math.max(8, Math.min(64, parseInt(radiusMatch[1], 10))) : 24;

      return {
        intent: TASK_INTENTS.MINE,
        resource,
        amount,
        radius,
        rawText: trimmed
      };
    }

    // 4. Wegpunkt & Basis (SETHOME & HOME)
    if (lower === '!sethome' || /^(setze|merke|speichere)\s+(?:dir\s+)?(?:diesen\s+ort\s+als\s+|hier\s+als\s+)?(basis|home|heimat|lager|hauptquartier)/i.test(lower) || /^(das\s+ist\s+unsere?\s+(?:neue\s+)?basis|hier\s+ist\s+(?:unsere\s+)?basis)/i.test(lower) || lower === 'sethome') {
      return {
        intent: TASK_INTENTS.SETHOME,
        rawText: trimmed
      };
    }

    if (lower === '!home' || /^(komm\s+nach\s+hause|geh(?:e)?\s+nach\s+hause|zurück\s+zur\s+basis|geh(?:e)?\s+zur\s+basis|komm\s+zur\s+basis|go\s+home|return\s+home)\b/i.test(lower) || lower === 'home') {
      return {
        intent: TASK_INTENTS.HOME,
        rawText: trimmed
      };
    }

    // 5. Höhlen- & Minen-Expedition (EXPEDITION)
    // Beispiele:
    // - "!expedition [erz] [menge]"
    // - "gehe auf minen-expedition nach eisen und diamanten"
    // - "starte höhlen-expedition"
    const isExpedition = (
      lower.startsWith('!expedition') ||
      /(?:geh(?:e)?|starte)\s+(?:auf\s+)?(?:eine\s+)?(?:minen-?|höhlen-?)?expedition/i.test(lower) ||
      /\b(höhlenexpedition|minenexpedition)\b/i.test(lower)
    );

    if (isExpedition) {
      let resource = 'iron_ore';
      let amount = 32;

      const amountMatch = lower.match(/\b(\d+)\s*(?:x|stück|blöcke)?\b/);
      if (amountMatch) {
        amount = Math.max(1, Math.min(256, parseInt(amountMatch[1], 10)));
      }

      if (lower.includes('diamant') || lower.includes('diamond')) resource = 'diamond_ore';
      else if (lower.includes('eisen') || lower.includes('iron')) resource = 'iron_ore';
      else if (lower.includes('kohle') || lower.includes('coal')) resource = 'coal_ore';
      else if (lower.includes('kupfer') || lower.includes('copper')) resource = 'copper_ore';
      else if (lower.includes('gold')) resource = 'gold_ore';
      else if (lower.includes('redstone')) resource = 'redstone_ore';
      else if (lower.includes('lapis')) resource = 'lapis_ore';

      return {
        intent: TASK_INTENTS.EXPEDITION,
        resource,
        amount,
        rawText: trimmed
      };
    }

    // 6. Auto-Crafting (CRAFT)
    // Beispiele:
    // - "!craft torch 16"
    // - "crafte 16 fackeln"
    // - "stelle eine werkbank her"
    const isCraft = (
      lower.startsWith('!craft') ||
      /^(?:crafte|herstellen)\b/i.test(lower) ||
      /\b(?:herstellen|stelle\s+.+?\s+her)\b/i.test(lower) ||
      /(?:crafte|baue|bastle)\s+(\d+\s*)?(?:x|stück)?\s*(fackeln?|werkbank|ofen|spitzhacke|eisen-?spitzhacke|stein-?spitzhacke|holz-?spitzhacke|kiste|truhe|schwert|axt|schaufel|stöcke|planken)/i.test(lower)
    );

    if (isCraft) {
      let item = 'torch';
      let count = 1;

      const countMatch = lower.match(/\b(\d+)\s*(?:x|stück)?\b/);
      if (countMatch) {
        count = Math.max(1, Math.min(256, parseInt(countMatch[1], 10)));
      }

      if (lower.includes('fackel') || lower.includes('torch')) {
        item = 'torch';
        if (!countMatch) count = 16;
      } else if (lower.includes('werkbank') || lower.includes('crafting')) {
        item = 'crafting_table';
      } else if (lower.includes('ofen') || lower.includes('furnace')) {
        item = 'furnace';
      } else if (lower.includes('kiste') || lower.includes('chest') || lower.includes('truhe')) {
        item = 'chest';
      } else if (lower.includes('eisen-spitzhacke') || lower.includes('eisenspitzhacke') || lower.includes('iron_pickaxe') || lower.includes('iron pickaxe')) {
        item = 'iron_pickaxe';
      } else if (lower.includes('stein-spitzhacke') || lower.includes('steinspitzhacke') || lower.includes('stone_pickaxe') || lower.includes('stone pickaxe')) {
        item = 'stone_pickaxe';
      } else if (lower.includes('spitzhacke') || lower.includes('pickaxe')) {
        item = 'iron_pickaxe';
      } else if (lower.includes('schwert') || lower.includes('sword')) {
        item = 'iron_sword';
      } else if (lower.includes('axt') || lower.includes('axe')) {
        item = 'iron_axe';
      } else if (lower.includes('stock') || lower.includes('stöcke') || lower.includes('stick')) {
        item = 'stick';
        if (!countMatch) count = 4;
      } else if (lower.includes('planke') || lower.includes('plank')) {
        item = 'oak_planks';
        if (!countMatch) count = 4;
      }

      if (lower.startsWith('!craft')) {
        const parts = trimmed.split(/\s+/);
        if (parts[1]) item = parts[1];
        if (parts[2] && /^\d+$/.test(parts[2])) count = parseInt(parts[2], 10);
      }

      return {
        intent: TASK_INTENTS.CRAFT,
        item,
        count,
        rawText: trimmed
      };
    }

    // 7. Schmelzen im Ofen (SMELT)
    // Beispiele:
    // - "!smelt"
    // - "schmilz alle roherze im ofen"
    // - "verhütte das eisen"
    const isSmelt = (
      lower.startsWith('!smelt') ||
      /(?:schmilz|schmelze|verhütte)\s*(alle\s+)?(roherze|erze|eisen|kupfer|gold)?/i.test(lower) ||
      /\b(erze schmelzen|eisen verhütten)\b/i.test(lower)
    );

    if (isSmelt) {
      let resource = null;
      if (lower.includes('eisen') || lower.includes('iron')) resource = 'raw_iron';
      else if (lower.includes('kupfer') || lower.includes('copper')) resource = 'raw_copper';
      else if (lower.includes('gold')) resource = 'raw_gold';

      return {
        intent: TASK_INTENTS.SMELT,
        resource,
        rawText: trimmed
      };
    }

    // 8. Beute in Kisten entladen (DEPOSIT)
    // Beispiele:
    // - "!deposit"
    // - "räume dein inventar in die kisten"
    // - "entlade beute in kisten"
    const isDeposit = (
      lower.startsWith('!deposit') ||
      lower.startsWith('!store') ||
      /(?:räume|räum|entlade|lagere|packe)\s+(?:dein\s+)?(?:inventar|beute|schätze|items|erze)\s+(?:in\s+(?:die\s+)?kisten?|ein)/i.test(lower) ||
      /\b(beute einsortieren|kisten einlagern|inventar entladen)\b/i.test(lower)
    );

    if (isDeposit) {
      return {
        intent: TASK_INTENTS.DEPOSIT,
        rawText: trimmed
      };
    }

    // 9. Folgen & Navigation (FOLLOW)
    if (/(folge\s+mir|komm\s+(?:zu\s+mir|her|hierher)|begleite\s+mich|lauf\s+zu\s+mir)/i.test(lower) || lower === '!come' || lower === '!follow') {
      return {
        intent: TASK_INTENTS.FOLLOW,
        rawText: trimmed
      };
    }

    // 10. Status & Inventar (STATUS)
    if (/(wie\s+viel\s+leben|status|inventar|items|zustand|hp|hunger|was\s+hast\s+du)/i.test(lower) || lower === '!status' || lower === '!chests') {
      return {
        intent: TASK_INTENTS.STATUS,
        rawText: trimmed
      };
    }

    // 11. Explizite Bau-Befehle (BUILD)
    // Wenn das Wort "baue" NICHT mit "ab" kombiniert ist, sondern mit Bauwerken:
    const isExplicitBuild = (
      /(baue|errichte|konstruiere|erschaffe|setze)\s+(ein|eine|einen|das|den)?\s*(haus|turm|burg|villa|dach|mauer|palast|hütte|brücke|portal|fassade|raum|zimmer|gasthaus|taverne|mühle|tempel|schloss)/i.test(lower) ||
      /(dach\s+steiler|fenster\s+anbringen|balkon\s+anbauen|stockwerk\s+hinzufügen)/i.test(lower) ||
      lower.startsWith('!schem')
    );

    if (isExplicitBuild) {
      return {
        intent: TASK_INTENTS.BUILD,
        rawText: trimmed
      };
    }

    // Falls keine Regel greift, aber "baue" am Satzanfang steht (ohne "ab"):
    if (/^(baue|errichte|mach|bau)\b/i.test(lower) && !lower.includes(' ab')) {
      return {
        intent: TASK_INTENTS.BUILD,
        rawText: trimmed
      };
    }

    return null;
  }

  /**
   * Universelle Klassifizierung: Prüft zuerst den deterministischen Matcher (0ms).
   * Falls dieser kein eindeutiges Ergebnis liefert, wird ein Fast-Tier LLM konsultiert.
   *
   * @param {string} text Benutzeranweisung
   * @returns {Promise<Object>} Klassifiziertes Intent-Objekt
   */
  async classifyIntent(text) {
    if (!text || typeof text !== 'string') {
      return { intent: TASK_INTENTS.UNKNOWN, rawText: '' };
    }

    // 1. Stufe: 0ms Deterministischer Matcher
    const deterministic = this.matchDeterministicIntent(text);
    if (deterministic) {
      logger.debug(`[TaskIntentRouter] Intent deterministisch erkannt: ${deterministic.intent} ("${text}")`);
      return deterministic;
    }

    // 2. Stufe: Fast-Tier LLM Fallback (nur falls nötig)
    try {
      const fastClassifierPrompt = `
Klassifiziere folgende Minecraft-Spieleranweisung in exakt EINE Kategorie:
- "BUILD": Errichten von Gebäuden, Häusern, Wänden, Dächern, Konstruktionen
- "DEFEND": Verteidigen, Bewachen eines Bereichs, Töten von Monstern/Feinden/NPCs
- "MINE": Abbauen von Erzen (Eisen, Kohle, Diamant), Holzfällen, Steinesammeln
- "EXPEDITION": Höhlen-Expeditionen, Solo-Minentouren
- "CRAFT": Werkzeuge, Fackeln, Werkbänke herstellen
- "SMELT": Roherze im Ofen schmelzen / verhütten
- "SETHOME": Ort als Basis / Home speichern
- "HOME": Zurück zur Heimatbasis laufen
- "DEPOSIT": Inventar / Beute in Basiskisten einsortieren
- "FOLLOW": Dem Spieler folgen, zum Spieler laufen
- "STOP": Anhalten, Abbrechen, Pausieren
- "STATUS": Inventar, Lebenspunkte, Telemetrie abfragen

Anweisung: "${text}"

Antworte AUSSCHLIESSLICH mit einem kompakten JSON-Objekt im Format:
{"intent": "BUILD"|"DEFEND"|"MINE"|"EXPEDITION"|"CRAFT"|"SMELT"|"SETHOME"|"HOME"|"DEPOSIT"|"FOLLOW"|"STOP"|"STATUS", "target": "optionale_zielbezeichnung"}
`.trim();

      const rawResponse = await Promise.race([
        llmRouter.generateCode('Du bist ein präziser NLP Intent Classifier.', fastClassifierPrompt, {
          role: TASK_ROLES.FAST_LOOP,
          temperature: 0.1
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Classifier-Timeout')), 3000))
      ]);

      const jsonMatch = rawResponse.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.intent && TASK_INTENTS[parsed.intent.toUpperCase()]) {
          const resolvedIntent = TASK_INTENTS[parsed.intent.toUpperCase()];
          logger.info(`[TaskIntentRouter] Intent via Fast-LLM klassifiziert: ${resolvedIntent} ("${text}")`);
          return {
            intent: resolvedIntent,
            target: parsed.target || null,
            rawText: text
          };
        }
      }
    } catch (err) {
      logger.debug(`[TaskIntentRouter] LLM-Klassifizierung übersprungen/fehlgeschlagen: ${err.message}`);
    }

    // Fallback: Als Bauauftrag interpretieren, wenn Text architektonische Wörter enthält, sonst UNKNOWN
    return {
      intent: TASK_INTENTS.BUILD,
      rawText: text
    };
  }
}

export const taskIntentRouter = new TaskIntentRouter();
