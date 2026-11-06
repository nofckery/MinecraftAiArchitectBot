/**
 * Computes Levenshtein distance between two strings for fuzzy matching.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function levenshteinDistance(a, b) {
  const strA = a === null || a === undefined ? '' : String(a);
  const strB = b === null || b === undefined ? '' : String(b);
  if (strA.length === 0) return strB.length;
  if (strB.length === 0) return strA.length;
  const matrix = [];
  for (let i = 0; i <= strB.length; i++) matrix[i] = [i];
  for (let j = 0; j <= strA.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= strB.length; i++) {
    for (let j = 1; j <= strA.length; j++) {
      if (strB.charAt(i - 1) === strA.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[strB.length][strA.length];
}
