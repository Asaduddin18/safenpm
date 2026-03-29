/**
 * writer.ts
 *
 * Writes the package-capabilities.json file to the project root.
 * Called at the end of `safenpm install` after all profiles are
 * gathered and user approvals are collected.
 */

import fs from 'fs'
import path from 'path'
import type { CapabilitiesFile } from './schema'

/**
 * Serializes and writes the capabilities file.
 * Overwrites any existing file.
 *
 * @param capabilities  The full capabilities object to serialize
 * @param projectRoot   Directory to write to (defaults to process.cwd())
 */
export function writeCapabilities(
  capabilities: CapabilitiesFile,
  projectRoot: string = process.cwd()
): void {
  const outputPath = path.join(projectRoot, 'package-capabilities.json')
  const content = JSON.stringify(capabilities, null, 2) + '\n'
  fs.writeFileSync(outputPath, content, 'utf8')
}
