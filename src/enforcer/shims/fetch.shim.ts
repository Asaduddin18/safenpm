/**
 * fetch.shim.ts
 *
 * Wraps globalThis.fetch to enforce per-package net capabilities.
 *
 * Unlike the http/https shims (which are created once when a package calls
 * require('http') and already know the caller), the fetch shim must identify
 * the calling package at invocation time because globalThis.fetch is a single
 * shared function — not a per-require() instance.
 *
 * Caller identification uses an injected getCaller() function (defaults to
 * getCallerPackageFromStack) so the shim is fully unit-testable without
 * touching the real call stack.
 */

import type { CapabilitiesFile, ViolationHandler } from '../../capabilities/schema'
import { logViolation } from '../violation-logger'
import { checkNetAccess } from './net-helpers'

// Derive the fetch input/init types from the global fetch signature so we
// don't depend on DOM lib types (our tsconfig uses lib: ["ES2020"] only).
type FetchInput = Parameters<typeof globalThis.fetch>[0]
type FetchInit  = Parameters<typeof globalThis.fetch>[1]

/**
 * Extracts the hostname from any valid fetch() first argument:
 *   - string URL   → new URL(str).hostname
 *   - URL object   → url.hostname
 *   - Request obj  → new URL(req.url).hostname
 */
function resolveHostFromInput(input: FetchInput): string {
  if (typeof input === 'string') {
    try { return new URL(input).hostname } catch { return input }
  }
  if (input instanceof URL) {
    return input.hostname
  }
  // Request object — has a .url string property
  if (typeof (input as { url?: unknown }).url === 'string') {
    try { return new URL((input as { url: string }).url).hostname } catch { return 'unknown' }
  }
  return 'unknown'
}

/**
 * Creates a capability-enforcing wrapper around globalThis.fetch.
 *
 * @param realFetch    The original fetch function to delegate allowed calls to
 * @param capabilities The full capabilities file (all packages)
 * @param getCaller    Injected fn returning the calling npm package name (or null for user code)
 * @param onViolation  Injected violation handler (defaults to logViolation)
 */
export function createFetchShim(
  realFetch: typeof globalThis.fetch,
  capabilities: CapabilitiesFile,
  getCaller: () => string | null,
  onViolation: ViolationHandler = logViolation
): typeof globalThis.fetch {
  return function patchedFetch(
    input: FetchInput,
    init?: FetchInit
  ): Promise<Response> {
    // Identify calling package from the current stack
    const callerPackage = getCaller()

    // User's own application code — unrestricted
    if (!callerPackage) return realFetch(input, init)

    // Resolve the target hostname
    const host = resolveHostFromInput(input)

    // Look up this package's capability profile
    const profile = capabilities.packages[callerPackage] ?? null

    // checkNetAccess throws synchronously on violation.
    // Convert to a rejected Promise to match fetch's async contract.
    try {
      checkNetAccess(host, 'fetch', profile, callerPackage, onViolation)
    } catch (err) {
      return Promise.reject(err)
    }

    return realFetch(input, init)
  }
}
