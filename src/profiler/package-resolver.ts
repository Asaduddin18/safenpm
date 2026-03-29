/**
 * package-resolver.ts
 *
 * Reads a project's node_modules directory and returns metadata for every
 * installed package. Handles scoped packages (@scope/name) and skips
 * dot-directories (.bin, .cache) and broken installs (no package.json).
 */

import fs from 'fs'
import path from 'path'

export interface InstalledPackage {
  /** Package name as read from package.json (canonical) */
  name: string
  /** Version string from package.json */
  version: string
  /** Absolute path to the package directory */
  pkgDir: string
}

/**
 * Returns all installed packages found in `<projectRoot>/node_modules`.
 * Returns an empty array if node_modules does not exist.
 */
export function resolveInstalledPackages(projectRoot: string): InstalledPackage[] {
  const nodeModules = path.join(projectRoot, 'node_modules')

  if (!fs.existsSync(nodeModules)) return []

  const results: InstalledPackage[] = []

  for (const entry of readDir(nodeModules)) {
    // Skip dot-directories like .bin, .cache, .package-lock.json
    if (entry.name.startsWith('.')) continue

    // isDirectory() returns false for symlinks (file: local installs on Windows/macOS).
    // Use isEntryDir() which follows the symlink via fs.statSync.
    const entryPath = path.join(nodeModules, entry.name)
    if (isEntryDir(entry, entryPath)) {
      if (entry.name.startsWith('@')) {
        // Scoped package: node_modules/@scope/name
        for (const scopedEntry of readDir(entryPath)) {
          const scopedPath = path.join(entryPath, scopedEntry.name)
          if (isEntryDir(scopedEntry, scopedPath)) {
            const pkg = readPackageJson(scopedPath)
            if (pkg) results.push(pkg)
          }
        }
      } else {
        const pkg = readPackageJson(entryPath)
        if (pkg) results.push(pkg)
      }
    }
  }

  return results
}

/** Returns true if the dirent is a real directory OR a symlink pointing to a directory. */
function isEntryDir(entry: fs.Dirent, resolvedPath: string): boolean {
  if (entry.isDirectory()) return true
  if (entry.isSymbolicLink()) {
    try { return fs.statSync(resolvedPath).isDirectory() } catch { return false }
  }
  return false
}

function readDir(dir: string): fs.Dirent[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function readPackageJson(pkgDir: string): InstalledPackage | null {
  const pkgJsonPath = path.join(pkgDir, 'package.json')
  try {
    const raw = fs.readFileSync(pkgJsonPath, 'utf8')
    const parsed = JSON.parse(raw) as { name?: string; version?: string }
    if (!parsed.name || !parsed.version) return null
    return { name: parsed.name, version: parsed.version, pkgDir }
  } catch {
    return null
  }
}
