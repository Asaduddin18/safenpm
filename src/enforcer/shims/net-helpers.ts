/**
 * net-helpers.ts
 *
 * Shared utilities for net, http, and https shims.
 * Centralizing here avoids duplication across 3 shim files.
 */

import type { Violation, ViolationSeverity, ViolationReason } from '../../capabilities/schema'

/**
 * Extracts the destination hostname from net.connect / http.request arguments.
 * Handles all calling forms:
 *   net.connect({ host: 'example.com', port: 443 })
 *   net.connect(443, 'example.com')
 *   http.request('https://example.com/path')
 *   http.request(new URL('https://example.com'))
 *   http.request({ hostname: 'example.com' })
 */
export function resolveHost(args: unknown[]): string {
  const first = args[0]

  if (typeof first === 'string') {
    // Could be a URL string or a plain hostname
    try {
      return new URL(first).hostname
    } catch {
      return first // treat as raw hostname
    }
  }

  if (first instanceof URL) return first.hostname

  if (first !== null && typeof first === 'object') {
    const opts = first as Record<string, unknown>
    return String(opts['host'] ?? opts['hostname'] ?? 'unknown')
  }

  // net.connect(port, host) positional form
  if (typeof args[1] === 'string') return args[1]

  return 'unknown'
}

/**
 * Returns true if `host` is permitted by the `allowedHosts` list.
 * Supported patterns:
 *   '*'            — any host
 *   '*.example.com'— any subdomain (not the bare domain itself)
 *   'api.example.com' — exact match
 */
export function isHostAllowed(host: string, allowedHosts: string[]): boolean {
  return allowedHosts.some(pattern => {
    if (pattern === '*') return true

    if (pattern.startsWith('*.')) {
      // *.example.com matches sub.example.com but NOT example.com
      const suffix = pattern.slice(1) // '.example.com'
      return host.endsWith(suffix) && host !== suffix.slice(1)
    }

    return host === pattern
  })
}

/**
 * Shared network access check used by net, http, and https shims.
 * Throws (and calls onViolation) if the connection should be blocked.
 */
export function checkNetAccess(
  host: string,
  methodName: string,
  profile: import('../../capabilities/schema').PackageCapability | null,
  packageName: string,
  onViolation: import('../../capabilities/schema').ViolationHandler
): void {
  if (!profile) {
    onViolation(buildNetViolation(packageName, 'unknown', methodName, host, 'CRITICAL', 'NO_CAPABILITY_PROFILE'))
    throw new Error(`[safenpm] BLOCKED: ${packageName} has no capability profile`)
  }

  if (!profile.net.outbound) {
    onViolation(buildNetViolation(packageName, profile.version, methodName, host, 'HIGH', 'UNAUTHORIZED_OUTBOUND_CONNECTION'))
    throw new Error(`[safenpm] BLOCKED: ${packageName} is not allowed outbound network access`)
  }

  if (!isHostAllowed(host, profile.net.hosts)) {
    onViolation(buildNetViolation(packageName, profile.version, methodName, host, 'CRITICAL', 'CONNECTION_TO_UNAUTHORIZED_HOST'))
    throw new Error(`[safenpm] BLOCKED: ${packageName} cannot connect to ${host}`)
  }
}

/** Builds a Violation record for network-related blocks. */
export function buildNetViolation(
  packageName: string,
  packageVersion: string,
  methodName: string,
  host: string,
  severity: ViolationSeverity,
  reason: ViolationReason
): Violation {
  return {
    timestamp: new Date().toISOString(),
    severity,
    package: packageName,
    packageVersion,
    attempted: `${methodName}(host: '${host}')`,
    reason,
    blocked: true,
    stackTrace: new Error().stack?.split('\n').slice(1) ?? [],
  }
}
