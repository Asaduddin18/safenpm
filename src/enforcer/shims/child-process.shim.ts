/**
 * child-process.shim.ts
 *
 * Wraps Node's child_process module to enforce spawn capability profiles.
 *
 * Default: all spawning is blocked.
 * When allowed: true with no allowedCommands — any command is permitted but logged.
 * When allowed: true with allowedCommands — only whitelisted executables are permitted.
 *
 * All spawns (even allowed ones) are logged as LOW audit violations so
 * there is always a record of what the package executed.
 */

import type { PackageCapability, Violation, ViolationHandler } from '../../capabilities/schema'
import { logViolation } from '../violation-logger'

const SPAWN_METHODS = new Set([
  'exec', 'execSync',
  'spawn', 'spawnSync',
  'execFile', 'execFileSync',
  'fork',
])

export function createChildProcessShim(
  realCp: Record<string, unknown>,
  profile: PackageCapability | null,
  packageName: string,
  onViolation: ViolationHandler = logViolation
): Record<string, unknown> {
  return new Proxy(realCp, {
    get(target, prop: string) {
      if (SPAWN_METHODS.has(prop)) {
        return function (...args: unknown[]): unknown {
          const command = extractCommand(prop, args)

          // No profile — block everything
          if (!profile) {
            onViolation(buildCpViolation(packageName, 'unknown', prop, command, 'CRITICAL', 'NO_CAPABILITY_PROFILE', true))
            throw new Error(`[safenpm] BLOCKED: ${packageName} has no capability profile`)
          }

          const cpProfile = profile.child_process

          // Spawning is not allowed at all
          if (!cpProfile.allowed) {
            onViolation(buildCpViolation(packageName, profile.version, prop, command, 'HIGH', 'UNAUTHORIZED_PROCESS_SPAWN', true))
            throw new Error(`[safenpm] BLOCKED: ${packageName} is not allowed to spawn processes`)
          }

          // Spawning allowed but limited to specific commands
          if (cpProfile.allowedCommands) {
            const executable = getExecutable(command)
            if (!cpProfile.allowedCommands.includes(executable)) {
              onViolation(buildCpViolation(packageName, profile.version, prop, command, 'HIGH', 'UNAUTHORIZED_PROCESS_SPAWN', true))
              throw new Error(`[safenpm] BLOCKED: ${packageName} cannot run ${executable}`)
            }
          }

          // Allowed — log for audit trail and pass through
          onViolation(buildCpViolation(packageName, profile.version, prop, command, 'LOW', 'PROCESS_SPAWN_AUDIT', false))
          return (target[prop] as (...a: unknown[]) => unknown)(...args)
        }
      }
      return target[prop]
    },
  })
}

/** Extracts the command string from the first argument. */
function extractCommand(method: string, args: unknown[]): string {
  const first = args[0]
  if (typeof first === 'string') return first
  // fork(modulePath) — first arg is a path
  if (method === 'fork') return String(first ?? '')
  return String(first ?? '')
}

/** Extracts the bare executable name from a command string. */
function getExecutable(command: string): string {
  return command.trim().split(/\s+/)[0] ?? command
}

function buildCpViolation(
  packageName: string,
  packageVersion: string,
  methodName: string,
  command: string,
  severity: Violation['severity'],
  reason: Violation['reason'],
  blocked: boolean
): Violation {
  return {
    timestamp: new Date().toISOString(),
    severity,
    package: packageName,
    packageVersion,
    attempted: `child_process.${methodName}('${command}')`,
    reason,
    blocked,
    stackTrace: new Error().stack?.split('\n').slice(1) ?? [],
  }
}
