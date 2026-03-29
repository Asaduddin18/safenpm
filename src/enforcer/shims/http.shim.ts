/**
 * http.shim.ts
 *
 * Wraps Node's http module to enforce outbound connection capabilities.
 * Intercepts http.request() and http.get().
 */

import type { PackageCapability, ViolationHandler } from '../../capabilities/schema'
import { logViolation } from '../violation-logger'
import { checkNetAccess, resolveHost } from './net-helpers'

export function createHttpShim(
  realHttp: Record<string, unknown>,
  profile: PackageCapability | null,
  packageName: string,
  onViolation: ViolationHandler = logViolation
): Record<string, unknown> {
  return new Proxy(realHttp, {
    get(target, prop: string) {
      if (prop === 'request' || prop === 'get') {
        return function (...args: unknown[]): unknown {
          const host = resolveHost(args)
          checkNetAccess(host, `http.${prop}`, profile, packageName, onViolation)
          return (target[prop] as (...a: unknown[]) => unknown)(...args)
        }
      }
      return target[prop]
    },
  })
}
