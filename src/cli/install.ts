/**
 * install.ts
 *
 * Orchestrates the `safenpm install` command:
 *  1. Run npm install to actually install the packages
 *  2. Profile the project's node_modules to discover all package capabilities
 *  3. Print a summary of each package's capability profile
 *  4. Write package-capabilities.json to the project root
 *
 * In a future iteration, this will prompt the user to approve each profile
 * before writing. For now it writes with approvedBy='auto'.
 */

import { execSync } from 'child_process'
import { profileProject } from '../profiler/index'
import { writeCapabilities } from '../capabilities/writer'
import { formatProfile } from '../ui/approval-prompt'

export interface InstallOptions {
  projectRoot?: string
  /** If true, skip the npm install step (used in tests) */
  skipNpmInstall?: boolean
}

/**
 * Runs the install + profile + write pipeline.
 *
 * @param packages     Package names to install (may be empty = re-profile only)
 * @param options      Configuration overrides
 */
export async function runInstall(
  packages: string[],
  options: InstallOptions = {}
): Promise<void> {
  const projectRoot = options.projectRoot ?? process.cwd()

  // Step 1: Run npm install
  if (!options.skipNpmInstall && packages.length > 0) {
    const pkgList = packages.join(' ')
    process.stdout.write(`[safenpm] Installing ${pkgList}...\n`)
    execSync(`npm install ${pkgList}`, { cwd: projectRoot, stdio: 'inherit' })
  }

  // Step 2: Profile all packages
  process.stdout.write('[safenpm] Profiling installed packages...\n')
  const capabilities = await profileProject(projectRoot)

  // Step 3: Print summary
  const pkgNames = Object.keys(capabilities.packages)
  process.stdout.write(`\n[safenpm] Found ${pkgNames.length} package(s):\n\n`)

  for (const [name, profile] of Object.entries(capabilities.packages)) {
    process.stdout.write(formatProfile(name, profile))
    process.stdout.write('\n\n')
  }

  // Step 4: Write capabilities file
  writeCapabilities(capabilities, projectRoot)
  process.stdout.write(`[safenpm] Wrote package-capabilities.json\n`)
  process.stdout.write('[safenpm] Done. Load enforcer with: node --require safenpm your-app.js\n')
}
