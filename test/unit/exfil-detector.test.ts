/**
 * exfil-detector.test.ts
 *
 * Tests for src/utils/exfil-detector.ts
 * Verifies that DNS exfiltration attempts (data encoded in subdomain labels)
 * are detected while legitimate hostnames are not false-positived.
 */

import { describe, it, expect } from 'vitest'
import { looksLikeExfiltration } from '../../src/utils/exfil-detector'

describe('looksLikeExfiltration — should detect exfiltration', () => {
  it('detects long base64-encoded subdomain (classic exfil pattern)', () => {
    // base64 of "this is stolen data" padded to multiple of 4
    const encoded = Buffer.from('this is stolen data').toString('base64')
    expect(looksLikeExfiltration(`${encoded}.evil.com`)).toBe(true)
  })

  it('detects hex-encoded subdomain', () => {
    // 32 hex chars = 16 bytes of data
    expect(looksLikeExfiltration('deadbeefdeadbeef1234567890abcdef.evil.com')).toBe(true)
  })

  it('detects suspiciously long subdomain label (> 32 chars)', () => {
    const longLabel = 'a'.repeat(33)
    expect(looksLikeExfiltration(`${longLabel}.evil.com`)).toBe(true)
  })

  it('detects base64url-encoded subdomain', () => {
    const b64url = Buffer.from('AWS_SECRET=abc123xyz').toString('base64url')
    expect(looksLikeExfiltration(`${b64url}.attacker.io`)).toBe(true)
  })

  it('detects multi-level exfiltration (data split across subdomains)', () => {
    // Each chunk is 20+ chars of base64
    const chunk1 = 'QVdTX1NFQ1JFVF9LRVk9'  // 20 chars, base64
    const chunk2 = 'c3RvbGVuZGF0YXh4eHh4'  // 20 chars, base64
    expect(looksLikeExfiltration(`${chunk1}.${chunk2}.evil.com`)).toBe(true)
  })
})

describe('looksLikeExfiltration — legitimate hostnames (no false positives)', () => {
  const legitimate = [
    'api.github.com',
    'npm.registry.org',
    'cdn.jsdelivr.net',
    'registry.npmjs.org',
    'smtp.gmail.com',
    'mail.example.co.uk',
    's3.amazonaws.com',
    'my-app.vercel.app',
    'subdomain.example.com',
    'localhost',
    '127.0.0.1',
    'internal-service',
    'api-v2.myservice.io',
  ]

  for (const host of legitimate) {
    it(`does NOT flag legitimate host "${host}"`, () => {
      expect(looksLikeExfiltration(host)).toBe(false)
    })
  }
})

describe('looksLikeExfiltration — edge cases', () => {
  it('handles single-label hostname (no dots)', () => {
    expect(looksLikeExfiltration('localhost')).toBe(false)
  })

  it('handles IP addresses', () => {
    expect(looksLikeExfiltration('192.168.1.1')).toBe(false)
    expect(looksLikeExfiltration('10.0.0.1')).toBe(false)
  })

  it('handles empty string without throwing', () => {
    expect(() => looksLikeExfiltration('')).not.toThrow()
    expect(looksLikeExfiltration('')).toBe(false)
  })

  it('short base64-looking string under threshold is NOT flagged', () => {
    // 'YWJj' is base64 of 'abc' — too short to be suspicious
    expect(looksLikeExfiltration('YWJj.example.com')).toBe(false)
  })
})
