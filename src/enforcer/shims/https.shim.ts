/**
 * https.shim.ts
 *
 * Wraps Node's https module to enforce outbound connection capabilities.
 * Identical structure to http.shim.ts — both modules expose request/get.
 */

import type { PackageCapability, ViolationHandler } from '../../capabilities/schema'
import { logViolation } from '../violation-logger'
import { checkNetAccess, resolveHost } from './net-helpers'

export function createHttpsShim(
  realHttps: Record<string, unknown>,
  profile: PackageCapability | null,
  packageName: string,
  onViolation: ViolationHandler = logViolation
): Record<string, unknown> {
  return new Proxy(realHttps, {
    get(target, prop: string) {
      if (prop === 'request' || prop === 'get') {
        return function (...args: unknown[]): unknown {
          const host = resolveHost(args)
          checkNetAccess(host, `https.${prop}`, profile, packageName, onViolation)
          return (target[prop] as (...a: unknown[]) => unknown)(...args)
        }
      }
      return target[prop]
    },
  })
}
