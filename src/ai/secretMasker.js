/**
 * Regex defining invisible, control, and zero-width characters to strip.
 * Covers Unicode Category C (Other: Cc, Cf, Cs, Co, Cn) including zero-width spaces, joiners, BOM, and NULL.
 * - \s: Standard whitespace
 * - \u200B-\u200D: Zero-width space, zero-width non-joiner, zero-width joiner
 * - \uFEFF: Zero-width no-break space (Byte Order Mark)
 * - \x00-\x1F: ASCII C0 control characters (NUL, SOH, STX, BEL, ESC, etc.)
 * - \x7F: ASCII DEL control character
 */
export const INVISIBLE_AND_CONTROL_CHARS = /[\s\u200B-\u200D\uFEFF\x00-\x1F\x7F]/g;

/**
 * Pure bullet, black circle, or asterisk masks of 1 or more characters.
 */
export const PURE_BULLET_MASK_REGEX = /^[•●\*]+$/;

/**
 * Prefixed bullet, black circle, or asterisk masks with optional suffix.
 */
export const PREFIXED_BULLET_MASK_REGEX = /^[a-zA-Z0-9_-]+[•●\*]+[a-zA-Z0-9_\-\.\+=]*$/i;

/**
 * Naked ellipsis of 3 or more dots.
 */
export const NAKED_ELLIPSIS_REGEX = /^\.{3,}$/;

/**
 * Prefix, infix, or suffix ellipsis patterns without requiring a mandatory suffix.
 */
export const GENERAL_ELLIPSIS_MASK_REGEX = /^[a-zA-Z0-9_-]*\.{3,}[a-zA-Z0-9_\-\.\+=]*$/i;

/**
 * Masks a secret API key or token for UI display and logging.
 * Shows prefix...suffix, or bullets for short secrets (<= 8 chars).
 * Strips invisible and control characters before computing mask.
 *
 * @param {string} secret
 * @returns {string}
 */
export function maskSecret(secret) {
  if (typeof secret !== 'string') return '';
  const cleaned = secret.replace(INVISIBLE_AND_CONTROL_CHARS, '');
  if (cleaned.length === 0) return '';

  // Short secrets (<= 8 characters) are never partially exposed
  if (cleaned.length <= 8) {
    return '••••••••';
  }

  // Detect common provider prefixes (e.g. sk-proj-, sk-or-v1-, gho_, gsk_, csk_)
  const prefixMatch = cleaned.match(/^([a-z0-9_-]{3,12}_)/i) ||
                      cleaned.match(/^(sk-proj-|sk-or-v1-|sk-ant-api\d\d-|sk-)/i);
  const prefix = prefixMatch ? prefixMatch[0] : cleaned.slice(0, 4);
  const suffix = cleaned.slice(-4);

  // Overlap protection for short strings
  if (prefix.length + suffix.length >= cleaned.length) {
    return `${cleaned.slice(0, 3)}...${suffix}`;
  }

  return `${prefix}...${suffix}`;
}

/**
 * Hardened check to detect masked placeholder strings from web UI / inputs.
 * Prevents masked placeholders, zero-width characters, control bytes,
 * and trivially corrupted inputs from accidentally overwriting actual keys.
 *
 * @param {any} value
 * @returns {boolean}
 */
export function isMaskedPlaceholder(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0) return false;

  // 1. Strip all Unicode whitespace, format, control, and zero-width characters
  const cleaned = value.replace(INVISIBLE_AND_CONTROL_CHARS, '');
  if (cleaned.length === 0) return true;

  // 2. Pure bullet / asterisk / dot masks
  if (PURE_BULLET_MASK_REGEX.test(cleaned)) return true;

  // 3. Prefixed bullet / asterisk masks (e.g. "sk-••••", "csk_********")
  if (PREFIXED_BULLET_MASK_REGEX.test(cleaned)) return true;

  // 4. Naked ellipsis (e.g. "...", "....")
  if (NAKED_ELLIPSIS_REGEX.test(cleaned)) return true;

  // 5. Hardened ellipsis patterns with optional prefix and suffix
  if (GENERAL_ELLIPSIS_MASK_REGEX.test(cleaned)) return true;

  // 6. Guard against trivially short corrupted inputs (< 8 chars unless explicitly 'none' or 'test')
  if (cleaned.length < 8 && !['none', 'test'].includes(cleaned.toLowerCase())) {
    return true;
  }

  return false;
}
