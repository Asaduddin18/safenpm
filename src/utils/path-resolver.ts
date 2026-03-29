/**
 * path-resolver.ts
 *
 * Resolves any path input to a canonical absolute path.
 * Handles: ~ expansion, relative paths, parent-traversal (..).
 * Used by the fs shim and path-matcher to normalize paths before
 * comparing them against capability profiles.
 */

import path from 'path'
import os from 'os'

/**
 * Resolves a path string to a canonical absolute path.
 * - Expands leading ~ to the user's home directory
 * - Resolves relative paths against process.cwd()
 * - Removes any .. traversal components
 */
export function resolvePath(inputPath: string): string {
  if (!inputPath) return path.resolve(inputPath)

  // expand ~ and ~/... to home directory
  if (inputPath === '~') {
    return os.homedir()
  }
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) {
    return path.resolve(os.homedir(), inputPath.slice(2))
  }

  return path.resolve(inputPath)
}

/**
 * Returns a normalized, lowercased absolute path for comparison.
 * Lowercasing matters on case-insensitive file systems (macOS, Windows)
 * so that /TMP and /tmp are treated as the same path.
 */
export function normalizeForComparison(inputPath: string): string {
  return resolvePath(inputPath).toLowerCase()
}
