/**
 * profiler/index.ts
 *
 * Orchestrates the profiling pipeline:
 *  1. Resolve all installed packages from node_modules
 *  2. Detect native modules for each package
 *  3. Build a default all-deny capability profile for each package
 *     (observations from install-script-runner would be fed in here in P4+)
 *  4. Return a complete CapabilitiesFile ready for user review
 *
 * In Phase 4, this will also run install scripts in a sandboxed environment
 * to observe actual accesses and populate profiles with real observations.
 * For now (Phase 3), all profiles are all-deny defaults.
 */

import { resolveInstalledPackages } from './package-resolver'
import { hasNativeModules } from './native-detector'
import { buildProfile } from './profile-builder'
import type { CapabilitiesFile } from '../capabilities/schema'

/**
 * Scans the project's node_modules and builds a CapabilitiesFile.
 *
 * @param projectRoot  Root directory of the project (must contain node_modules)
 */
export async function profileProject(projectRoot: string): Promise<CapabilitiesFile> {
  const packages = resolveInstalledPackages(projectRoot)
  const result: CapabilitiesFile = {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    projectRoot,
    packages: {},
  }

  for (const pkg of packages) {
    const profile = buildProfile(pkg.name, pkg.version, [])
    profile.hasNativeModules = hasNativeModules(pkg.pkgDir)
    result.packages[pkg.name] = profile
  }

  return result
}
