/**
 * fetch-shim.test.ts
 *
 * Unit tests for createFetchShim.
 * Written BEFORE implementation (TDD).
 *
 * createFetchShim wraps globalThis.fetch and enforces per-package net
 * capabilities at call time. Unlike the http/https shims (which are created
 * once per require() call and already know the caller), the fetch shim must
 * identify the caller on every invocation via an injected getCaller fn.
 */

import { describe, it, expect, vi } from 'vitest'
import type { CapabilitiesFile, ViolationHandler } from '../../src/capabilities/schema'
import { createFetchShim } from '../../src/enforcer/shims/fetch.shim'

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeCapabilities(
  packageName: string,
  netOutbound: boolean,
  netHosts: string[]
): CapabilitiesFile {
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

/** A fake fetch that resolves immediately — never makes real network calls. */
const fakeFetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }))

// ─── tests ────────────────────────────────────────────────────────────────────

describe('createFetchShim', () => {
  it('returns a function', () => {
    const caps = makeCapabilities('pkg', false, [])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')
    expect(typeof shim).toBe('function')
  })

  // ── blocking ────────────────────────────────────────────────────────────────

  it('rejects when package has no net permission (outbound: false)', async () => {
    const caps = makeCapabilities('sneaky', false, [])
    const shim = createFetchShim(fakeFetch, caps, () => 'sneaky')

    await expect(shim('https://evil.io/steal')).rejects.toThrow('[safenpm] BLOCKED')
  })

  it('rejects when outbound is true but host is not in the allowlist', async () => {
    const caps = makeCapabilities('sneaky', true, ['api.allowed.com'])
    const shim = createFetchShim(fakeFetch, caps, () => 'sneaky')

    await expect(shim('https://evil.io/steal')).rejects.toThrow('[safenpm] BLOCKED')
  })

  it('rejects when package has no capability profile at all', async () => {
    const caps: CapabilitiesFile = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      projectRoot: '/test',
      packages: {},  // no entry for 'unknown-pkg'
    }
    const violations: unknown[] = []
    const shim = createFetchShim(fakeFetch, caps, () => 'unknown-pkg', v => violations.push(v))

    await expect(shim('https://evil.io')).rejects.toThrow('[safenpm] BLOCKED')
    expect(violations).toHaveLength(1)
    expect((violations[0] as { reason: string }).reason).toBe('NO_CAPABILITY_PROFILE')
  })

  // ── allowing ────────────────────────────────────────────────────────────────

  it('calls real fetch when exact host is in the allowlist', async () => {
    fakeFetch.mockClear()
    const caps = makeCapabilities('pkg', true, ['api.stripe.com'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')

    await shim('https://api.stripe.com/v1/charges')
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it('calls real fetch when wildcard * is in the allowlist', async () => {
    fakeFetch.mockClear()
    const caps = makeCapabilities('pkg', true, ['*'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')

    await shim('https://anything.example.com/data')
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it('calls real fetch when subdomain wildcard matches', async () => {
    fakeFetch.mockClear()
    const caps = makeCapabilities('pkg', true, ['*.github.com'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')

    await shim('https://api.github.com/repos')
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it('blocks when subdomain wildcard does NOT match bare domain', async () => {
    const caps = makeCapabilities('pkg', true, ['*.github.com'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')

    // *.github.com should NOT match github.com itself
    await expect(shim('https://github.com/login')).rejects.toThrow('[safenpm] BLOCKED')
  })

  // ── user application code ────────────────────────────────────────────────────

  it('passes fetch through unrestricted when caller is null (user app code)', async () => {
    fakeFetch.mockClear()
    const caps = makeCapabilities('some-pkg', false, [])  // deny-all profile
    // getCaller returns null → user code, not an npm package
    const shim = createFetchShim(fakeFetch, caps, () => null)

    await shim('https://anything.io/data')
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  // ── violation handler ────────────────────────────────────────────────────────

  it('calls the violation handler with correct fields on block', async () => {
    const violations: unknown[] = []
    const caps = makeCapabilities('malicious', false, [])
    const shim = createFetchShim(fakeFetch, caps, () => 'malicious', v => violations.push(v))

    await expect(shim('https://evil.io/exfil')).rejects.toThrow()

    expect(violations).toHaveLength(1)
    const v = violations[0] as Record<string, unknown>
    expect(v['package']).toBe('malicious')
    expect(v['blocked']).toBe(true)
    expect(v['attempted']).toContain('fetch')
    expect(v['attempted']).toContain('evil.io')
  })

  it('does not call the violation handler when access is allowed', async () => {
    fakeFetch.mockClear()
    const violations: unknown[] = []
    const caps = makeCapabilities('pkg', true, ['safe.io'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg', v => violations.push(v))

    await shim('https://safe.io/data')
    expect(violations).toHaveLength(0)
  })

  // ── URL and Request input forms ───────────────────────────────────────────────

  it('resolves hostname from a URL object', async () => {
    fakeFetch.mockClear()
    const caps = makeCapabilities('pkg', true, ['api.example.com'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')

    await shim(new URL('https://api.example.com/data'))
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it('resolves hostname from a Request object', async () => {
    fakeFetch.mockClear()
    const caps = makeCapabilities('pkg', true, ['api.example.com'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')

    await shim(new Request('https://api.example.com/data'))
    expect(fakeFetch).toHaveBeenCalledOnce()
  })

  it('blocks when Request URL host is not allowed', async () => {
    const caps = makeCapabilities('pkg', true, ['safe.io'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')

    await expect(shim(new Request('https://evil.io/steal'))).rejects.toThrow('[safenpm] BLOCKED')
  })

  // ── return value ─────────────────────────────────────────────────────────────

  it('returns the Response from the real fetch on success', async () => {
    const mockResponse = new Response('hello', { status: 200 })
    const customFetch = vi.fn().mockResolvedValue(mockResponse)
    const caps = makeCapabilities('pkg', true, ['*'])
    const shim = createFetchShim(customFetch, caps, () => 'pkg')

    const result = await shim('https://example.com/')
    expect(result).toBe(mockResponse)
  })

  it('forwards the init options to the real fetch', async () => {
    fakeFetch.mockClear()
    const caps = makeCapabilities('pkg', true, ['api.example.com'])
    const shim = createFetchShim(fakeFetch, caps, () => 'pkg')
    const init: RequestInit = { method: 'POST', body: JSON.stringify({ x: 1 }) }

    await shim('https://api.example.com/data', init)
    expect(fakeFetch).toHaveBeenCalledWith('https://api.example.com/data', init)
  })
})
