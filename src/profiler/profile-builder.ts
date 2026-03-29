/**
 * profile-builder.ts
 *
 * Converts a list of Violation observations (recorded during a profiling run)
 * into a PackageCapability profile that grants only the minimum required access.
 *
 * Design decisions:
 *  - CREDENTIAL_THEFT_ATTEMPT violations are intentionally NOT added to env[]
 *    because we never want to auto-approve secret access, even if observed.
 *  - Paths and hosts are deduplicated via Set.
 *  - approvedBy is always 'auto' — the user must manually upgrade to 'user'.
 */

import type { PackageCapability, Violation } from '../capabilities/schema'

/**
 * Builds a PackageCapability from observed violations.
 *
 * @param packageName   The npm package name
 * @param version       The package version string
 * @param observations  Violations recorded during install/runtime profiling
 */
export function buildProfile(
  packageName: string,
  version: string,
  observations: Violation[]
): PackageCapability {
  const fsRead = new Set<string>()
  const fsWrite = new Set<string>()
  const netHosts = new Set<string>()
  const envVars = new Set<string>()
  let netOutbound = false
  let childProcessAllowed = false

  for (const v of observations) {
    switch (v.reason) {
      case 'UNAUTHORIZED_FS_READ':
      case 'CREDENTIAL_THEFT_ATTEMPT': {
        // Credential theft is via fs — add to read list if it's a path access
        if (v.reason === 'UNAUTHORIZED_FS_READ') {
          const p = extractPath(v.attempted)
          if (p) fsRead.add(p)
        }
        break
      }

      case 'UNAUTHORIZED_FS_WRITE': {
        const p = extractPath(v.attempted)
        if (p) fsWrite.add(p)
        break
      }

      case 'UNAUTHORIZED_OUTBOUND_CONNECTION':
      case 'CONNECTION_TO_UNAUTHORIZED_HOST':
      case 'DNS_BLOCKED_NO_NET_PERMISSION': {
        netOutbound = true
        const host = extractHost(v.attempted)
        if (host) netHosts.add(host)
        break
      }

      case 'UNDECLARED_ENV_ACCESS': {
        // Only safe (non-secret) env vars — secrets are never auto-approved
        const varName = extractEnvVar(v.attempted)
        if (varName) envVars.add(varName)
        break
      }

      case 'UNAUTHORIZED_PROCESS_SPAWN': {
        childProcessAllowed = true
        break
      }
    }
  }

  return {
    version,
    fs: {
      read: Array.from(fsRead),
      write: Array.from(fsWrite),
    },
    net: {
      outbound: netOutbound,
      hosts: Array.from(netHosts),
    },
    env: Array.from(envVars),
    child_process: { allowed: childProcessAllowed },
    worker_threads: false,
    hasNativeModules: false,
    approvedBy: 'auto',
    approvedAt: new Date().toISOString(),
    userNote: `Auto-generated profile for ${packageName}`,
  }
}

// ─── Extraction helpers ──────────────────────────────────────────────────────

/**
 * Extracts a file path from an attempted string like:
 *   "readFileSync(/etc/config.json)"
 *   "writeFileSync(/tmp/output.log)"
 */
function extractPath(attempted: string): string | null {
  const match = attempted.match(/\(([^)]+)\)/)
  if (!match) return null
  const raw = match[1].trim()
  // Must look like an absolute path
  return raw.startsWith('/') || /^[A-Za-z]:\\/.test(raw) ? raw : null
}

/**
 * Extracts a hostname from an attempted string like:
 *   "https.request(api.example.com)"
 *   "net.connect(api.example.com:443)"
 *   "dns.lookup(evil.io)"
 */
function extractHost(attempted: string): string | null {
  const match = attempted.match(/\(([^)]+)\)/)
  if (!match) return null
  // Strip optional port suffix
  return match[1].split(':')[0].trim() || null
}

/**
 * Extracts an env var name from an attempted string like:
 *   "process.env.NODE_ENV"
 *   "process.env.PORT"
 */
function extractEnvVar(attempted: string): string | null {
  const match = attempted.match(/process\.env\.([A-Z_][A-Z0-9_]*)/)
  return match ? match[1] : null
}
