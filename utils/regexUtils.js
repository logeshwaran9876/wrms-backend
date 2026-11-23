/**
 * Escapes regex special characters in a string to safely use it in new RegExp() or MongoDB $regex.
 * Escapes: . * + ? ^ $ { } ( ) | [ ] \
 */
export function escapeRegex(string) {
  if (typeof string !== 'string') return '';
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
