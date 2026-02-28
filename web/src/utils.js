/** Shared micro-helpers used across multiple modules. */

/**
 * Build a string coordinate key from grid (x, y) indices.
 * Canonical format: "x-y", e.g. "3-7".
 */
export function coordKey(x, y) {
  return `${x}-${y}`;
}
