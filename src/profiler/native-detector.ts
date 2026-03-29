/**
 * native-detector.ts
 *
 * Recursively scans a package directory for compiled native addon files (.node).
 * These are N-API / nan binary addons that bypass JavaScript security boundaries
 * and deserve elevated scrutiny in the capability profile.
 */

import fs from 'fs'
import path from 'path'

/**
 * Returns true if the package directory contains any .node binary addon file.
 * Returns false if the directory does not exist or contains no .node files.
 *
 * @param pkgDir  Absolute path to the package root directory
 */
export function hasNativeModules(pkgDir: string): boolean {
  try {
    return scanDir(pkgDir)
  } catch {
    return false
  }
}

function scanDir(dir: string): boolean {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return false
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (scanDir(path.join(dir, entry.name))) return true
    } else if (entry.isFile() && entry.name.endsWith('.node')) {
      return true
    }
  }

  return false
}
