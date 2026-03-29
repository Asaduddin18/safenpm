/**
 * net.shim.ts
 *
 * Wraps Node's net module to enforce outbound connection capabilities.
 * Intercepts connect() and createConnection() — the two ways a package
 * opens a raw TCP socket.
 */

import type { PackageCapability, ViolationHandler } from '../../capabilities/schema'
import { logViolation } from '../violation-logger'
import { checkNetAccess, resolveHost } from './net-helpers'

export function createNetShim(
  realNet: Record<string, unknown>,
  profile: PackageCapability | null,
  packageName: string,
  onViolation: ViolationHandler = logViolation
): Record<string, unknown> {
  return new Proxy(realNet, {
    get(target, prop: string) {
      if (prop === 'connect' || prop === 'createConnection') {
        return function (...args: unknown[]): unknown {
          const host = resolveHost(args)
          checkNetAccess(host, `net.${prop}`, profile, packageName, onViolation)
          return (target[prop] as (...a: unknown[]) => unknown)(...args)
        }
      }
      return target[prop]
    },
  })
}
