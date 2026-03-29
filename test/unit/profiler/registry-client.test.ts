/**
 * registry-client.test.ts
 * Unit tests for fetchDownloadCount — written BEFORE implementation (TDD).
 *
 * We test via dependency injection: the fetch function is passed in,
 * so we can mock registry responses without actual network calls.
 */

import { describe, it, expect } from 'vitest'
import { fetchDownloadCount } from '../../../src/profiler/registry-client'

// ─── Mock fetch helpers ──────────────────────────────────────────────────────

function mockFetch(responseBody: unknown, statusCode = 200) {
  return async (_url: string): Promise<{ ok: boolean; json: () => Promise<unknown> }> => ({
    ok: statusCode >= 200 && statusCode < 300,
    json: async () => responseBody,
  })
}

function failingFetch(): (_url: string) => Promise<never> {
  return async (_url: string): Promise<never> => {
    throw new Error('Network error')
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('fetchDownloadCount', () => {
  it('returns the weekly download count from a valid registry response', async () => {
    const fetch = mockFetch({ downloads: 1_234_567 })
    const count = await fetchDownloadCount('express', fetch)
    expect(count).toBe(1_234_567)
  })

  it('returns 0 when the registry request fails (network error)', async () => {
    const count = await fetchDownloadCount('express', failingFetch())
    expect(count).toBe(0)
  })

  it('returns 0 when the response status is not ok (404)', async () => {
    const fetch = mockFetch({ error: 'not found' }, 404)
    const count = await fetchDownloadCount('nonexistent-pkg-xyz', fetch)
    expect(count).toBe(0)
  })

  it('returns 0 when response body has no downloads field', async () => {
    const fetch = mockFetch({ something: 'else' })
    const count = await fetchDownloadCount('some-pkg', fetch)
    expect(count).toBe(0)
  })

  it('handles scoped package names (@ prefix is URL-encoded)', async () => {
    // The real registry API uses %2F for slashes in scoped names
    let capturedUrl = ''
    const fetch = async (url: string) => {
      capturedUrl = url
      return { ok: true, json: async () => ({ downloads: 42 }) }
    }
    await fetchDownloadCount('@aws-sdk/client-s3', fetch)
    // URL must have the scoped name encoded so / becomes %2F
    expect(capturedUrl).toContain('%40aws-sdk%2Fclient-s3')
  })

  it('returns 0 when downloads field is not a number', async () => {
    const fetch = mockFetch({ downloads: 'many' })
    const count = await fetchDownloadCount('pkg', fetch)
    expect(count).toBe(0)
  })
})
