/**
 * dns.shim.ts
 *
 * Wraps Node's dns module to:
 *  1. Block all DNS lookups when the package has no net.outbound permission
 *  2. Block DNS lookups that look like data exfiltration (encoded subdomains)
 *
 * DNS exfiltration is the most covert exfiltration channel: data is
 * encoded in subdomain labels. The lookup exits the machine as DNS traffic,
 * which is often not monitored or filtered.
 */

import type { PackageCapability, Violation, ViolationHandler } from '../../capabilities/schema'
import { looksLikeExfiltration } from '../../utils/exfil-detector'
import { logViolation } from '../violation-logger'

const DNS_METHODS = new Set([
  'lookup', 'resolve', 'resolve4', 'resolve6',
  'resolveMx', 'resolveTxt', 'resolveSrv', 'resolveNs', 'resolveCname',
])

export function createDnsShim(
  realDns: Record<string, unknown>,
  profile: PackageCapability | null,
  packageName: string,
  onViolation: ViolationHandler = logViolation
): Record<string, unknown> {
  return new Proxy(realDns, {
    get(target, prop: string) {
      if (DNS_METHODS.has(prop)) {
        return function (...args: unknown[]): unknown {
          const hostname = String(args[0] ?? '')

          // No profile — block everything
          if (!profile) {
            onViolation(buildDnsViolation(packageName, 'unknown', prop, hostname, 'CRITICAL', 'NO_CAPABILITY_PROFILE'))
            throw new Error(`[safenpm] BLOCKED: ${packageName} has no capability profile`)
          }

          // No outbound permission — block all DNS
          if (!profile.net.outbound) {
            onViolation(buildDnsViolation(packageName, profile.version, prop, hostname, 'HIGH', 'DNS_BLOCKED_NO_NET_PERMISSION'))
            throw new Error(`[safenpm] BLOCKED: ${packageName} has no network permission`)
          }

          // Exfiltration pattern detected — block even if net is allowed
          if (looksLikeExfiltration(hostname)) {
            onViolation(buildDnsViolation(packageName, profile.version, prop, hostname, 'CRITICAL', 'DNS_EXFILTRATION_ATTEMPT'))
            throw new Error(`[safenpm] BLOCKED: ${packageName} DNS query looks like exfiltration: ${hostname}`)
          }

          // Allow the real DNS call
          return (target[prop] as (...a: unknown[]) => unknown)(...args)
        }
      }
      return target[prop]
    },
  })
}

function buildDnsViolation(
  packageName: string,
  packageVersion: string,
  methodName: string,
  hostname: string,
  severity: Violation['severity'],
  reason: Violation['reason']
): Violation {
  return {
    timestamp: new Date().toISOString(),
    severity,
    package: packageName,
    packageVersion,
    attempted: `dns.${methodName}('${hostname}')`,
    reason,
    blocked: true,
    stackTrace: new Error().stack?.split('\n').slice(1) ?? [],
  }
}
