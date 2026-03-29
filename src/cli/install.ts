/**
 * install.ts
 *
 * Orchestrates the `safenpm install` command:
 *  1. Run npm install to actually install the packages (if any given)
 *  2. Profile the project's node_modules to discover all package capabilities
 *  3. Run the interactive approval session (unless --yes is passed)
 *  4. Write the approved package-capabilities.json to the project root
 */

import { execSync } from 'child_process'
import { profileProject } from '../profiler/index'
import { writeCapabilities } from '../capabilities/writer'
import { runApprovalSession, createReadlineIO } from '../ui/interactive-approval'
import type { CapabilitiesFile } from '../capabilities/schema'

export interface InstallOptions {
  projectRoot?: string
  /** If true, skip the interactive prompt and auto-approve all profiles */
  autoApprove?: boolean
  /** If true, skip the npm install step (used in tests / re-profile only) */
  skipNpmInstall?: boolean
}

/**
 * Runs the install + profile + approve + write pipeline.
 *
 * @param packages  Package names to install (empty = re-profile only)
 * @param options   Configuration overrides
 */
export async function runInstall(
  packages: string[],
  options: InstallOptions = {}
): Promise<void> {
  const projectRoot  = options.projectRoot  ?? process.cwd()
  const autoApprove  = options.autoApprove  ?? false

  // ── Step 1: npm install ────────────────────────────────────────────
  if (!options.skipNpmInstall && packages.length > 0) {
    const pkgList = packages.join(' ')
    process.stdout.write(`[safenpm] Installing ${pkgList}...\n`)
    execSync(`npm install ${pkgList}`, { cwd: projectRoot, stdio: 'inherit' })
  }

  // ── Step 2: Profile all packages ──────────────────────────────────
  process.stdout.write('[safenpm] Profiling installed packages...\n')
  const capabilities: CapabilitiesFile = await profileProject(projectRoot)
  const count = Object.keys(capabilities.packages).length

  if (count === 0) {
    process.stdout.write('[safenpm] No packages found in node_modules.\n')
    writeCapabilities(capabilities, projectRoot)
    return
  }

  process.stdout.write(`[safenpm] Found ${count} package(s).\n`)

  // ── Step 3: Approve ────────────────────────────────────────────────
  let approved: CapabilitiesFile

  if (autoApprove) {
    // --yes flag: stamp every profile as user-approved without prompting
    process.stdout.write('[safenpm] --yes flag set — auto-approving all profiles.\n')
    approved = {
      ...capabilities,
      packages: Object.fromEntries(
        Object.entries(capabilities.packages).map(([name, profile]) => [
          name,
          { ...profile, approvedBy: 'user' as const },
        ])
      ),
    }
  } else {
    // Interactive approval
    const io = createReadlineIO()
    try {
      approved = await runApprovalSession(capabilities, io)
    } finally {
      io.close()
    }
  }

  // ── Step 4: Write ──────────────────────────────────────────────────
  writeCapabilities(approved, projectRoot)

  const approvedCount = Object.values(approved.packages)
    .filter(p => p.approvedBy === 'user').length

  process.stdout.write(`\n[safenpm] Wrote package-capabilities.json\n`)
  process.stdout.write(`[safenpm] ${approvedCount}/${count} packages approved.\n`)
  process.stdout.write('[safenpm] Run your app with: node --require safenpm/dist/enforcer/index.js app.js\n')
}
