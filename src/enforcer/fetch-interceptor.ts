/**
 * fetch-interceptor.ts
 *
 * Patches globalThis.fetch to enforce per-package net capabilities.
 *
 * Why a separate file from module-interceptor.ts:
 *   The Module._load patch covers require()-based imports. globalThis.fetch
 *   is a first-class global available in Node 18+ — it bypasses require()
 *   entirely, so it needs its own install/uninstall lifecycle.
 *
 * Usage:
 *   installFetchInterceptor(capabilities)   ← called from enforcer/index.ts
 *   uninstallFetchInterceptor()             ← called from uninstallInterceptor() in tests
 */

import type { CapabilitiesFile } from '../capabilities/schema'
import { getCallerPackageFromStack } from './caller-resolver'
import { createFetchShim } from './shims/fetch.shim'
import { logViolation } from './violation-logger'

/** The real fetch saved when we install, so we can restore it on uninstall. */
let originalFetch: typeof globalThis.fetch | null = null

/**
 * Replaces globalThis.fetch with a capability-enforcing shim.
 *
 * Safe to call multiple times — if already installed, the previous interceptor
 * is first uninstalled so we never double-wrap.
 *
 * If globalThis.fetch does not exist (Node < 18 without --experimental-fetch),
 * this function is a no-op.
 *
 * @param capabilities  The full capabilities file to enforce against
 */
export function installFetchInterceptor(capabilities: CapabilitiesFile): void {
  // No native fetch — nothing to intercept
  if (typeof globalThis.fetch !== 'function') return

  // Idempotent: uninstall any previous shim before re-wrapping
  if (originalFetch !== null) {
    globalThis.fetch = originalFetch
  }

  // Save the current (real) fetch
  originalFetch = globalThis.fetch

  // Replace with shim — passes getCallerPackageFromStack as the caller resolver
  globalThis.fetch = createFetchShim(
    originalFetch,
    capabilities,
    getCallerPackageFromStack,
    logViolation
  )
}

/**
 * Restores globalThis.fetch to the value it had before installFetchInterceptor
 * was called. Safe to call when not installed (no-op).
 */
export function uninstallFetchInterceptor(): void {
  if (originalFetch !== null) {
    globalThis.fetch = originalFetch
    originalFetch = null
  }
}
