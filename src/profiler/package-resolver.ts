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

    if (entry.isDirectory()) {
      if (entry.name.startsWith('@')) {
        // Scoped package: node_modules/@scope/name
        const scopeDir = path.join(nodeModules, entry.name)
        for (const scopedEntry of readDir(scopeDir)) {
          if (scopedEntry.isDirectory()) {
            const pkgDir = path.join(scopeDir, scopedEntry.name)
            const pkg = readPackageJson(pkgDir)
            if (pkg) results.push(pkg)
          }
        }
      } else {
        const pkgDir = path.join(nodeModules, entry.name)
        const pkg = readPackageJson(pkgDir)
        if (pkg) results.push(pkg)
      }
    }
  }

  return results
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
