/**
 * env.proxy.ts
 *
 * Wraps a process.env-like object in a Proxy to enforce per-package
 * environment variable access policies.
 *
 * Rules:
 *  - Caller is null (user's own code): full access, no logging
 *  - Caller has declared the var in profile.env: full access, no logging
 *  - Caller accesses an undeclared non-secret var: allowed but LOW log
 *  - Caller accesses a known/pattern-matched secret: blocked, value hidden
 *  - Any caller writes to env: MEDIUM log, allowed
 *
 * The getCallerFn and onViolation are injectable for testability.
 */

import type { CapabilitiesFile, ViolationHandler } from '../../capabilities/schema'
import { isSecretEnvVar, getSecretSeverity } from '../../utils/secret-detector'
import { logViolation } from '../violation-logger'

/**
 * Creates a Proxy around `envSource` that enforces capability profiles.
 *
 * @param envSource     - The real env object (process.env or a copy)
 * @param capabilities  - The loaded package-capabilities.json contents
 * @param getCallerFn   - Returns the calling package name, or null for user code
 * @param onViolation   - Called whenever a violation is detected
 */
export function createEnvProxy(
  envSource: Record<string, string | undefined>,
  capabilities: CapabilitiesFile,
  getCallerFn: () => string | null,
  onViolation: ViolationHandler = logViolation
): Record<string, string | undefined> {
  return new Proxy(envSource, {
    get(target, prop: string): string | undefined {
      const callerPackage = getCallerFn()

      // User's own application code — unrestricted, no logging
      if (!callerPackage) return target[prop]

      const profile = capabilities.packages[callerPackage]
      const allowedVars: string[] = profile?.env ?? []

      // Explicitly declared in profile — allow silently
      if (allowedVars.includes(prop)) return target[prop]

      // Known or pattern-matched secret — block entirely
      if (isSecretEnvVar(prop)) {
        const severity = getSecretSeverity(prop)
        onViolation({
          timestamp: new Date().toISOString(),
          severity,
          package: callerPackage,
          packageVersion: profile?.version ?? 'unknown',
          attempted: `process.env.${prop}`,
          reason: 'CREDENTIAL_THEFT_ATTEMPT',
          blocked: true,
          stackTrace: new Error().stack?.split('\n').slice(1) ?? [],
        })
        return undefined // package gets undefined — key appears to not exist
      }

      // Undeclared non-secret var — allow but log at LOW
      onViolation({
        timestamp: new Date().toISOString(),
        severity: 'LOW',
        package: callerPackage,
        packageVersion: profile?.version ?? 'unknown',
        attempted: `process.env.${prop}`,
        reason: 'UNDECLARED_ENV_ACCESS',
        blocked: false,
        stackTrace: [],
      })
      return target[prop]
    },

    set(target, prop: string, value: string): boolean {
      const callerPackage = getCallerFn()

      // Only log when a package (not user code) mutates env
      if (callerPackage) {
        const profile = capabilities.packages[callerPackage]
        onViolation({
          timestamp: new Date().toISOString(),
          severity: 'MEDIUM',
          package: callerPackage,
          packageVersion: profile?.version ?? 'unknown',
          attempted: `process.env.${prop} = '${String(value).slice(0, 30)}'`,
          reason: 'ENV_MUTATION',
          blocked: false,
          stackTrace: [],
        })
      }

      target[prop] = value
      return true
    },
  })
}
