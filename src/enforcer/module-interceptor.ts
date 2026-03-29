/**
 * module-interceptor.ts
 *
 * Patches Node's Module._load to intercept require() calls for
 * sensitive built-in modules and return shims instead of the real modules.
 *
 * Key design decisions:
 *  - Uses Module._load (not Module.prototype.require) to catch ALL require
 *    calls, including those from native modules and indirect requires
 *  - Normalizes 'node:fs' → 'fs' to handle both calling styles
 *  - Caches shims per (packageName, moduleName) pair to avoid recreating
 *    proxies on every require() call in hot code paths
 *  - The interceptor can be uninstalled for test isolation
 */

import Module from 'module'
import { loadCapabilities } from '../capabilities/reader'
import { getCallerPackage, getCallerPackageFromStack } from './caller-resolver'
import { createFsShim } from './shims/fs.shim'
import { createNetShim } from './shims/net.shim'
import { createHttpShim } from './shims/http.shim'
import { createHttpsShim } from './shims/https.shim'
import { createDnsShim } from './shims/dns.shim'
import { createChildProcessShim } from './shims/child-process.shim'
import { createEnvProxy } from './shims/env.proxy'
import { logViolation } from './violation-logger'
import type { CapabilitiesFile, PackageCapability } from '../capabilities/schema'

/** Built-in module names we intercept (after node: prefix stripping). */
const SHIMMED_MODULES = new Set(['fs', 'net', 'http', 'https', 'dns', 'child_process'])

/** Cache: "packageName:moduleName" → shim object. */
const shimCache = new Map<string, unknown>()

/** Stored so the interceptor can be uninstalled. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originalLoad: ((...args: any[]) => unknown) | null = null

/**
 * Installs the Module._load interceptor.
 * Called once at startup (from enforcer/index.ts via --require).
 * @param projectRoot  Override for testing (defaults to process.cwd())
 */
export function installInterceptor(projectRoot?: string): void {
  const capabilities = loadCapabilities(projectRoot)

  if (!capabilities) {
    process.stderr.write(
      '[safenpm] No package-capabilities.json found. ' +
      'Run `safenpm install` first to generate it. Enforcer inactive.\n'
    )
    return
  }

  // Install process.env proxy before any module code runs
  installEnvProxy(capabilities)

  // Save original so we can uninstall for tests
  originalLoad = (Module as unknown as { _load: (...args: unknown[]) => unknown })._load

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(Module as unknown as { _load: (...args: any[]) => unknown })._load = function (
    request: string,
    parent: { filename?: string } | null,
    isMain: boolean
  ): unknown {
    // Always call the original first — it handles caching, resolution, etc.
    const realModule = (originalLoad as (...args: unknown[]) => unknown)(request, parent, isMain)

    // Normalize 'node:fs' → 'fs', 'node:net' → 'net', etc.
    const normalizedName = normalizeModuleName(request)

    if (!SHIMMED_MODULES.has(normalizedName)) return realModule

    // Identify which package is making this require() call
    const callerPackage = getCallerPackage(parent?.filename)

    // User's own application code — unrestricted
    if (!callerPackage) return realModule

    // Serve cached shim if available (hot path optimization)
    const cacheKey = `${callerPackage}:${normalizedName}`
    if (shimCache.has(cacheKey)) return shimCache.get(cacheKey)

    // Create a new shim for this package+module combination
    const profile = capabilities.packages[callerPackage] ?? null
    const shim = createShim(normalizedName, realModule, profile, callerPackage)

    shimCache.set(cacheKey, shim)
    return shim
  }
}

/**
 * Removes the Module._load interceptor and clears the shim cache.
 * Used in integration tests to restore clean state between test runs.
 */
export function uninstallInterceptor(): void {
  if (originalLoad) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(Module as unknown as { _load: (...args: any[]) => unknown })._load = originalLoad
    originalLoad = null
  }
  shimCache.clear()
}

/** Strips 'node:' prefix if present (Node 14.18+ supports both forms). */
function normalizeModuleName(request: string): string {
  return request.startsWith('node:') ? request.slice(5) : request
}

function installEnvProxy(capabilities: CapabilitiesFile): void {
  // Snapshot the real env BEFORE replacing it
  const realEnv = Object.assign({}, process.env) as Record<string, string | undefined>

  const proxy = createEnvProxy(
    realEnv,
    capabilities,
    () => getCallerPackageFromStack(),
    logViolation
  )

  Object.defineProperty(process, 'env', {
    value: proxy,
    writable: false,
    configurable: true, // configurable: true so tests can re-define it
  })
}

function createShim(
  moduleName: string,
  realModule: unknown,
  profile: PackageCapability | null,
  packageName: string
): unknown {
  const mod = realModule as Record<string, unknown>

  switch (moduleName) {
    case 'fs':            return createFsShim(mod, profile, packageName)
    case 'net':           return createNetShim(mod, profile, packageName)
    case 'http':          return createHttpShim(mod, profile, packageName)
    case 'https':         return createHttpsShim(mod, profile, packageName)
    case 'dns':           return createDnsShim(mod, profile, packageName)
    case 'child_process': return createChildProcessShim(mod, profile, packageName)
    default:              return realModule
  }
}
