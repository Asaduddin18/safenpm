/**
 * caller-resolver.ts
 *
 * Identifies which npm package triggered a module require() call by
 * inspecting the parent module's filename or the current call stack.
 *
 * Design:
 *  - getCallerPackage(filename) — fast path: extract from known filename
 *  - extractPackageName(filename) — pure function, no side effects
 *  - Cache keyed by filename to avoid repeated regex work on hot paths
 *  - clearCallerCache() — exported for test isolation
 *
 * Package name extraction rules:
 *  - Regular: /project/node_modules/lodash/... → 'lodash'
 *  - Scoped:  /project/node_modules/@types/node/... → '@types/node'
 *  - Nested:  /a/node_modules/pkg-a/node_modules/pkg-b/... → 'pkg-b' (innermost)
 *  - Windows: C:\project\node_modules\express\... → 'express'
 */

/** Cache: normalized file path → package name (or null for user code). */
const cache = new Map<string, string | null>()

/**
 * Returns the npm package name for the given module filename, or null
 * if the file belongs to the user's own application code.
 *
 * Results are cached. Call clearCallerCache() in tests to reset between cases.
 */
export function getCallerPackage(parentFilename: string | undefined): string | null {
  if (!parentFilename) return null

  if (cache.has(parentFilename)) {
    return cache.get(parentFilename) ?? null
  }

  const result = extractPackageName(parentFilename)
  cache.set(parentFilename, result)
  return result
}

/**
 * Pure function: extracts the npm package name from a file path.
 * Returns null for paths that are not inside node_modules.
 */
export function extractPackageName(filePath: string | undefined | null): string | null {
  if (!filePath) return null

  // Normalize Windows backslashes to forward slashes
  const normalized = filePath.replace(/\\/g, '/')

  // Skip node: built-in module references
  if (normalized.startsWith('node:')) return null

  // Find ALL occurrences of node_modules in the path.
  // Use the LAST (innermost) match to correctly handle nested node_modules.
  // Pattern covers:
  //   /node_modules/pkg-name/...        (regular)
  //   /node_modules/@scope/pkg-name/... (scoped)
  // Use lookahead (?=\/|$) instead of consuming the separator,
  // so the trailing / remains available for the NEXT node_modules segment.
  // Without this, nested paths like .../pkg-a/node_modules/pkg-b/...
  // lose the leading / of the second node_modules and only pkg-a is found.
  const regex = /\/node_modules\/((?:@[^/]+\/[^/]+)|(?:[^/]+))(?=\/|$)/g

  let lastMatch: RegExpExecArray | null = null
  let match: RegExpExecArray | null

  while ((match = regex.exec(normalized)) !== null) {
    lastMatch = match
  }

  return lastMatch ? lastMatch[1] : null
}

/**
 * Walks the current call stack and returns the first npm package name found.
 * Used by the env proxy (which doesn't have a parent filename available).
 * Slower than getCallerPackage() — avoid in hot paths.
 */
export function getCallerPackageFromStack(): string | null {
  const stack = new Error().stack ?? ''
  const lines = stack.split('\n').slice(1)

  for (const line of lines) {
    const normalized = line.replace(/\\/g, '/')
    const match = normalized.match(/\/node_modules\/((?:@[^/]+\/[^/]+)|(?:[^/]+))(?:\/|$)/)
    if (match) {
      // Skip safenpm's own enforcer code
      if (match[1].startsWith('safenpm')) continue
      return match[1]
    }
  }

  return null
}

/** Clears the filename → package name cache. Call in tests between cases. */
export function clearCallerCache(): void {
  cache.clear()
}
