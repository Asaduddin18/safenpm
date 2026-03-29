/**
 * fs.shim.ts
 *
 * Wraps Node's fs module in a Proxy that enforces per-package
 * filesystem capability profiles.
 *
 * Read ops: checked against profile.fs.read (list of allowed path patterns)
 * Write ops: checked against profile.fs.write
 *
 * The shim accepts an injectable ViolationHandler so tests can capture
 * violations without file I/O. Production uses logViolation() by default.
 */

import type { PackageCapability, Violation, ViolationHandler } from '../../capabilities/schema'
import { isPathAllowed, isSensitivePath } from '../../capabilities/path-matcher'
import { resolvePath } from '../../utils/path-resolver'
import { logViolation } from '../violation-logger'

/** All fs methods that read from the filesystem. */
const READ_OPS = new Set([
  'readFile', 'readFileSync',
  'createReadStream',
  'open', 'openSync',
  'read', 'readSync',
  'readdir', 'readdirSync',
  'readlink', 'readlinkSync',
  'stat', 'statSync',
  'lstat', 'lstatSync',
  'access', 'accessSync',
  'existsSync',
  'watch', 'watchFile',
])

/** All fs methods that write to the filesystem. */
const WRITE_OPS = new Set([
  'writeFile', 'writeFileSync',
  'createWriteStream',
  'appendFile', 'appendFileSync',
  'unlink', 'unlinkSync',
  'mkdir', 'mkdirSync',
  'rmdir', 'rmdirSync',
  'rm', 'rmSync',
  'rename', 'renameSync',
  'copyFile', 'copyFileSync',
  'chmod', 'chmodSync',
  'chown', 'chownSync',
  'truncate', 'truncateSync',
  'symlink', 'symlinkSync',
])

/**
 * Returns a Proxy around `realFs` that enforces `profile` for `packageName`.
 * Any access outside the profile calls `onViolation` and throws.
 */
export function createFsShim(
  realFs: Record<string, unknown>,
  profile: PackageCapability | null,
  packageName: string,
  onViolation: ViolationHandler = logViolation
): Record<string, unknown> {
  return new Proxy(realFs, {
    get(target, prop: string) {
      if (READ_OPS.has(prop)) {
        return createGuardedOp(target, prop, 'read', profile, packageName, onViolation)
      }
      if (WRITE_OPS.has(prop)) {
        return createGuardedOp(target, prop, 'write', profile, packageName, onViolation)
      }
      return target[prop]
    },
  })
}

function createGuardedOp(
  target: Record<string, unknown>,
  methodName: string,
  opType: 'read' | 'write',
  profile: PackageCapability | null,
  packageName: string,
  onViolation: ViolationHandler
): (...args: unknown[]) => unknown {
  return function (...args: unknown[]): unknown {
    const filePath = args[0] as string
    const resolved = resolvePath(String(filePath ?? ''))

    // No profile at all — deny everything
    if (!profile) {
      const v = buildViolation(packageName, 'unknown', methodName, resolved, opType, true, 'NO_CAPABILITY_PROFILE', 'HIGH')
      onViolation(v)
      throw new Error(`[safenpm] BLOCKED: ${packageName} has no capability profile (attempted fs.${methodName})`)
    }

    const allowed = opType === 'read' ? profile.fs.read : profile.fs.write

    if (!isPathAllowed(resolved, allowed)) {
      const sensitive = isSensitivePath(resolved)
      const severity = sensitive ? 'CRITICAL' : 'HIGH'
      const reason = opType === 'read'
        ? (sensitive ? 'CREDENTIAL_THEFT_ATTEMPT' : 'UNAUTHORIZED_FS_READ')
        : 'UNAUTHORIZED_FS_WRITE'

      const v = buildViolation(packageName, profile.version, methodName, resolved, opType, true, reason, severity)
      onViolation(v)
      throw new Error(`[safenpm] BLOCKED: ${packageName} cannot ${opType} ${resolved}`)
    }

    // Path is allowed — call through to real fs
    return (target[methodName] as (...a: unknown[]) => unknown)(...args)
  }
}

function buildViolation(
  pkg: string,
  version: string,
  methodName: string,
  resolvedPath: string,
  _opType: string,
  blocked: boolean,
  reason: Violation['reason'],
  severity: Violation['severity']
): Violation {
  return {
    timestamp: new Date().toISOString(),
    severity,
    package: pkg,
    packageVersion: version,
    attempted: `fs.${methodName}('${resolvedPath}')`,
    reason,
    blocked,
    stackTrace: new Error().stack?.split('\n').slice(1) ?? [],
  }
}
