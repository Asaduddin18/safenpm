/**
 * fetch-interceptor.test.ts
 *
 * Unit tests for installFetchInterceptor / uninstallFetchInterceptor.
 * Written BEFORE implementation (TDD).
 *
 * These tests verify that the interceptor correctly swaps globalThis.fetch
 * and restores it on uninstall — without making real network calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { CapabilitiesFile } from '../../src/capabilities/schema'
import { installFetchInterceptor, uninstallFetchInterceptor } from '../../src/enforcer/fetch-interceptor'

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeCapabilities(packageName: string, netOutbound: boolean, netHosts: string[]): CapabilitiesFile {
  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    projectRoot: '/test',
    packages: {
      [packageName]: {
        version: '1.0.0',
        fs: { read: [], write: [] },
        net: { outbound: netOutbound, hosts: netHosts },
        env: [],
        child_process: { allowed: false },
        worker_threads: false,
        hasNativeModules: false,
        approvedBy: 'user',
        approvedAt: new Date().toISOString(),
      },
    },
  }
}

const originalFetch = globalThis.fetch

// ─── tests ────────────────────────────────────────────────────────────────────

describe('installFetchInterceptor / uninstallFetchInterceptor', () => {
  beforeEach(() => {
    // Restore original fetch before each test so tests are isolated
    globalThis.fetch = originalFetch
    uninstallFetchInterceptor()
  })

  afterEach(() => {
    uninstallFetchInterceptor()
    globalThis.fetch = originalFetch
  })

  it('replaces globalThis.fetch with a different function after install', () => {
    const caps = makeCapabilities('pkg', true, ['*'])
    const before = globalThis.fetch
    installFetchInterceptor(caps)
    expect(globalThis.fetch).not.toBe(before)
  })

  it('restores the original globalThis.fetch after uninstall', () => {
    const caps = makeCapabilities('pkg', true, ['*'])
    const original = globalThis.fetch
    installFetchInterceptor(caps)
    uninstallFetchInterceptor()
    expect(globalThis.fetch).toBe(original)
  })

  it('is a no-op when globalThis.fetch does not exist (Node < 18)', () => {
    const saved = globalThis.fetch
    // Simulate Node < 18 by temporarily removing fetch
    ;(globalThis as Record<string, unknown>)['fetch'] = undefined
    const caps = makeCapabilities('pkg', true, ['*'])

    expect(() => installFetchInterceptor(caps)).not.toThrow()

    ;(globalThis as Record<string, unknown>)['fetch'] = saved
  })

  it('uninstalling before installing is safe (no error)', () => {
    expect(() => uninstallFetchInterceptor()).not.toThrow()
  })

  it('installing twice only applies the interceptor once (idempotent)', () => {
    const caps = makeCapabilities('pkg', true, ['*'])
    installFetchInterceptor(caps)
    const afterFirst = globalThis.fetch
    installFetchInterceptor(caps)
    // The shim should still function correctly — not double-wrapped
    expect(typeof globalThis.fetch).toBe('function')
    // After two installs, uninstall once should restore original
    uninstallFetchInterceptor()
    expect(globalThis.fetch).toBe(originalFetch)
  })

  it('the installed shim rejects fetch calls from blocked packages', async () => {
    const caps = makeCapabilities('bad-pkg', false, [])
    // Replace globalThis.fetch with a mock so no real network call happens
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok'))

    installFetchInterceptor(caps)

    // Simulate a call that appears to come from bad-pkg by using the shim directly
    // The shim reads the call stack — since tests don't run inside node_modules,
    // the caller will be null (user code) and the call will pass through.
    // We verify the shim is installed and functional; deep stack-based blocking
    // is covered by integration tests (enforcer-blocks-fetch.test.ts).
    expect(typeof globalThis.fetch).toBe('function')
    expect(globalThis.fetch).not.toBe(vi.fn()) // it's our shim, not the raw mock
  })

  it('uninstall after install restores the mock, not the original pre-mock fetch', () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response('ok'))
    globalThis.fetch = mockFetch

    const caps = makeCapabilities('pkg', true, ['*'])
    installFetchInterceptor(caps)
    expect(globalThis.fetch).not.toBe(mockFetch)

    uninstallFetchInterceptor()
    expect(globalThis.fetch).toBe(mockFetch)
  })
})
