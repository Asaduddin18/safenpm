/**
 * caller-resolver.test.ts
 *
 * Tests for src/enforcer/caller-resolver.ts
 * Verifies package name extraction from node_modules paths,
 * scoped packages, Windows paths, monorepo nested paths,
 * and cache behavior.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  getCallerPackage,
  extractPackageName,
  clearCallerCache,
} from '../../src/enforcer/caller-resolver'

beforeEach(() => {
  // reset the LRU cache between tests so cache hits don't bleed across tests
  clearCallerCache()
})

describe('extractPackageName', () => {
  it('extracts name from a regular package path', () => {
    expect(extractPackageName('/project/node_modules/lodash/lodash.js')).toBe('lodash')
  })

  it('extracts name from a scoped package path', () => {
    expect(extractPackageName('/project/node_modules/@types/node/index.d.ts')).toBe('@types/node')
    expect(extractPackageName('/project/node_modules/@aws-sdk/client-s3/dist/index.js')).toBe('@aws-sdk/client-s3')
  })

  it('returns null for user application code (no node_modules)', () => {
    expect(extractPackageName('/project/src/app.ts')).toBeNull()
    expect(extractPackageName('/project/src/utils/helper.ts')).toBeNull()
  })

  it('returns null for undefined/empty input', () => {
    expect(extractPackageName(undefined as unknown as string)).toBeNull()
    expect(extractPackageName('')).toBeNull()
  })

  it('handles Windows-style backslash paths', () => {
    const result = extractPackageName('C:\\project\\node_modules\\express\\index.js')
    expect(result).toBe('express')
  })

  it('handles Windows-style scoped package paths', () => {
    const result = extractPackageName('C:\\project\\node_modules\\@types\\node\\index.d.ts')
    expect(result).toBe('@types/node')
  })

  it('extracts name from deeply nested path within a package', () => {
    expect(
      extractPackageName('/project/node_modules/webpack/lib/Compiler.js')
    ).toBe('webpack')
  })

  it('handles monorepo nested node_modules (uses innermost package)', () => {
    // In a monorepo: /root/packages/app/node_modules/lodash/index.js
    // The caller is lodash, not any outer package
    const result = extractPackageName('/root/packages/app/node_modules/lodash/index.js')
    expect(result).toBe('lodash')
  })

  it('handles doubly-nested node_modules (hoisting edge case)', () => {
    // /project/node_modules/pkg-a/node_modules/pkg-b/index.js
    // The actual caller is pkg-b (the innermost)
    const result = extractPackageName(
      '/project/node_modules/pkg-a/node_modules/pkg-b/index.js'
    )
    expect(result).toBe('pkg-b')
  })

  it('returns null for node: internal module reference', () => {
    expect(extractPackageName('node:fs')).toBeNull()
    expect(extractPackageName('node:path')).toBeNull()
  })
})

describe('getCallerPackage', () => {
  it('returns package name from a node_modules filename', () => {
    expect(getCallerPackage('/project/node_modules/axios/lib/axios.js')).toBe('axios')
  })

  it('returns null for user application code', () => {
    expect(getCallerPackage('/project/src/server.ts')).toBeNull()
  })

  it('returns null for undefined parent filename', () => {
    expect(getCallerPackage(undefined)).toBeNull()
  })

  it('caches results — same input returns same output on repeated calls', () => {
    const input = '/project/node_modules/lodash/lodash.js'
    const first = getCallerPackage(input)
    const second = getCallerPackage(input)
    expect(first).toBe(second)
    expect(first).toBe('lodash')
  })

  it('cache does not confuse different package paths', () => {
    const a = getCallerPackage('/project/node_modules/express/index.js')
    const b = getCallerPackage('/project/node_modules/lodash/lodash.js')
    expect(a).toBe('express')
    expect(b).toBe('lodash')
  })

  it('clearCallerCache resets the cache so next call re-evaluates', () => {
    const input = '/project/node_modules/some-pkg/index.js'
    getCallerPackage(input) // populate cache
    clearCallerCache()
    // after clear, it should still work correctly (just re-computes)
    expect(getCallerPackage(input)).toBe('some-pkg')
  })
})
