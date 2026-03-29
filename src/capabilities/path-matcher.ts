/**
 * path-matcher.ts
 *
 * Checks whether a file path is within the set of paths a package
 * is allowed to access, and identifies universally sensitive paths
 * that should never be accessible regardless of profile.
 */

import path from 'path'
import os from 'os'
import { normalizeForComparison, resolvePath } from '../utils/path-resolver'

/**
 * Returns true if `requestedPath` falls within any of the `allowedPatterns`.
 *
 * Pattern matching rules:
 *  - Exact match: '/tmp/file.txt' allows only that exact file
 *  - Directory prefix: '/tmp' allows '/tmp' and anything under it
 *  - Glob suffix '/**': '/project/src/**' allows anything under /project/src/
 *
 * All comparisons are normalized (absolute + lowercased) so ~ and relative
 * paths work correctly regardless of how the pattern was specified.
 */
export function isPathAllowed(requestedPath: string, allowedPatterns: string[]): boolean {
  if (allowedPatterns.length === 0) return false

  const normalizedRequest = normalizeForComparison(requestedPath)

  return allowedPatterns.some(pattern => matchesPattern(normalizedRequest, pattern))
}

function matchesPattern(normalizedRequest: string, pattern: string): boolean {
  // Strip /** suffix to get the base directory
  if (pattern.endsWith('/**') || pattern.endsWith('\\**')) {
    const base = normalizeForComparison(pattern.replace(/[/\\]\*\*$/, ''))
    return normalizedRequest === base ||
           normalizedRequest.startsWith(base + '/') ||
           normalizedRequest.startsWith(base + '\\')
  }

  const normalizedPattern = normalizeForComparison(pattern)

  // Exact match
  if (normalizedRequest === normalizedPattern) return true

  // Directory prefix match (pattern is a directory, request is under it)
  const withSep = normalizedPattern.endsWith('/')
    ? normalizedPattern
    : normalizedPattern + '/'
  if (normalizedRequest.startsWith(withSep)) return true

  // Windows sep
  const withWinSep = normalizedPattern.endsWith('\\')
    ? normalizedPattern
    : normalizedPattern + '\\'
  if (normalizedRequest.startsWith(withWinSep)) return true

  return false
}

/**
 * Paths that are ALWAYS sensitive regardless of what a package's profile says.
 * Access to these should always be flagged as at least HIGH severity.
 */
const ALWAYS_SENSITIVE: string[] = [
  os.homedir(),         // ~/.aws, ~/.ssh, ~/.npmrc, etc.
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/proc',              // Linux process/memory info
  '/sys',               // Linux kernel interfaces
]

/**
 * Returns true if `resolvedPath` points to or under a universally
 * sensitive location (credentials, system files, kernel interfaces).
 */
export function isSensitivePath(resolvedPath: string): boolean {
  const normalized = resolvePath(resolvedPath)

  return ALWAYS_SENSITIVE.some(sensitive => {
    const normSensitive = path.resolve(sensitive)
    return normalized === normSensitive ||
           normalized.startsWith(normSensitive + path.sep) ||
           normalized.startsWith(normSensitive + '/')
  })
}
