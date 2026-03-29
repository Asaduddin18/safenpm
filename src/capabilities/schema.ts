/**
 * schema.ts
 *
 * Central type contract for safenpm. Every shim, profiler, and CLI function
 * operates on these interfaces. Defined first so all downstream code shares
 * a single source of truth for capability shapes.
 */

export interface FsCapability {
  /** Glob-compatible path patterns the package is allowed to READ from. */
  read: string[]
  /** Glob-compatible path patterns the package is allowed to WRITE to. */
  write: string[]
}

export interface NetCapability {
  /** Whether the package is allowed to make any outbound connection. */
  outbound: boolean
  /**
   * Allowed destination hostnames. Supports:
   *   '*'           — any host (only when outbound: true)
   *   '*.github.com'— any subdomain of github.com
   *   'api.stripe.com' — exact host match
   * Empty array with outbound: true means outbound is technically on
   * but no host is whitelisted — effectively blocked in practice.
   */
  hosts: string[]
}

export interface ChildProcessCapability {
  /** Whether the package may spawn any child processes at all. */
  allowed: boolean
  /**
   * Optional allowlist of specific executable names.
   * If allowed: true and allowedCommands is undefined, any command is permitted.
   * If allowed: true and allowedCommands is set, only those executables are permitted.
   */
  allowedCommands?: string[]
}

/** Full capability profile for a single package at a specific version. */
export interface PackageCapability {
  version: string
  fs: FsCapability
  net: NetCapability
  /** List of environment variable names the package is explicitly allowed to read. */
  env: string[]
  child_process: ChildProcessCapability
  /** Whether the package may spawn worker threads. */
  worker_threads: boolean
  /**
   * Whether the package contains compiled .node native modules.
   * When true, JS-level shims cannot fully enforce capabilities —
   * native code bypasses the Module._load interception layer.
   */
  hasNativeModules: boolean
  /** Source of the profile: registry consensus, explicit user approval, or auto-generated locally. */
  approvedBy: 'registry' | 'user' | 'auto'
  /** ISO 8601 timestamp of when this profile was approved/generated. */
  approvedAt: string
  /** Number of independent observations that make up the registry profile (if from registry). */
  registryObservations?: number
  /** Free-text note the user entered during the approval prompt. */
  userNote?: string
}

/**
 * The full package-capabilities.json file written to the project root.
 * Keyed by package name (e.g. 'lodash', '@aws-sdk/client-s3').
 */
export interface CapabilitiesFile {
  version: '1.0'
  generatedAt: string
  projectRoot: string
  packages: Record<string, PackageCapability>
}

/** Severity levels for violations, ordered low → critical. */
export type ViolationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

/** Reason codes for why a violation was raised. */
export type ViolationReason =
  | 'CREDENTIAL_THEFT_ATTEMPT'
  | 'UNAUTHORIZED_FS_READ'
  | 'UNAUTHORIZED_FS_WRITE'
  | 'UNAUTHORIZED_OUTBOUND_CONNECTION'
  | 'CONNECTION_TO_UNAUTHORIZED_HOST'
  | 'DNS_BLOCKED_NO_NET_PERMISSION'
  | 'DNS_EXFILTRATION_ATTEMPT'
  | 'UNAUTHORIZED_PROCESS_SPAWN'
  | 'UNAUTHORIZED_ENV_ACCESS'
  | 'ENV_MUTATION'
  | 'PROCESS_SPAWN_AUDIT'
  | 'NO_CAPABILITY_PROFILE'
  | 'UNDECLARED_ENV_ACCESS'

/** Structured record of a blocked (or logged) capability violation. */
export interface Violation {
  timestamp: string
  severity: ViolationSeverity
  /** Package name as it appears in node_modules (e.g. 'lodash', '@types/node'). */
  package: string
  packageVersion: string
  /** Human-readable description: what the package tried to do. */
  attempted: string
  reason: ViolationReason
  /** true if the operation was blocked, false if only logged (audit mode). */
  blocked: boolean
  /** Stack trace frames pointing into the package's own code. */
  stackTrace: string[]
}

/**
 * Callback type for violation handling.
 * Shims accept this as an injectable dependency so tests can capture
 * violations without writing to disk or stderr.
 */
export type ViolationHandler = (violation: Violation) => void
