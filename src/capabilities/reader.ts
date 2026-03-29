/**
 * reader.ts
 *
 * Reads and validates package-capabilities.json from disk.
 * Returns null if the file doesn't exist or is malformed —
 * the enforcer treats null as "no capabilities file, run in warning-only mode".
 */

import fs from 'fs'
import path from 'path'
import type { CapabilitiesFile } from './schema'

/**
 * Reads package-capabilities.json from the given directory.
 * @param projectRoot  Directory to look in (defaults to process.cwd())
 * @returns Parsed CapabilitiesFile or null
 */
export function loadCapabilities(projectRoot: string = process.cwd()): CapabilitiesFile | null {
  const capFile = path.join(projectRoot, 'package-capabilities.json')

  if (!fs.existsSync(capFile)) return null

  try {
    const raw = fs.readFileSync(capFile, 'utf8')
    const parsed = JSON.parse(raw) as CapabilitiesFile

    if (!parsed.version || !parsed.packages) {
      process.stderr.write('[safenpm] Warning: package-capabilities.json is malformed — enforcer inactive\n')
      return null
    }

    return parsed
  } catch (err) {
    process.stderr.write(`[safenpm] Warning: could not read package-capabilities.json — ${String(err)}\n`)
    return null
  }
}
