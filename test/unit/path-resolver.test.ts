/**
 * path-resolver.test.ts
 *
 * Tests for src/utils/path-resolver.ts
 * Verifies that all path forms (absolute, relative, ~, ..) resolve correctly
 * to canonical absolute paths for consistent capability enforcement.
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import os from 'os'
import { resolvePath, normalizeForComparison } from '../../src/utils/path-resolver'

describe('resolvePath', () => {
  it('returns absolute path unchanged', () => {
    const abs = '/tmp/some/file.txt'
    expect(resolvePath(abs)).toBe(path.resolve(abs))
  })

  it('expands ~ to the real home directory', () => {
    const result = resolvePath('~/.aws/credentials')
    expect(result).toBe(path.join(os.homedir(), '.aws', 'credentials'))
    expect(result).not.toContain('~')
  })

  it('expands ~/nested/path correctly', () => {
    const result = resolvePath('~/foo/bar/baz.json')
    expect(result).toBe(path.join(os.homedir(), 'foo', 'bar', 'baz.json'))
  })

  it('resolves relative path to absolute using process.cwd()', () => {
    const result = resolvePath('./src/app.ts')
    expect(path.isAbsolute(result)).toBe(true)
    expect(result).toBe(path.resolve('./src/app.ts'))
  })

  it('resolves parent-traversal paths to canonical absolute', () => {
    const result = resolvePath('../../../etc/passwd')
    expect(path.isAbsolute(result)).toBe(true)
    expect(result).not.toContain('..')
  })

  it('handles /etc/passwd as-is (already absolute)', () => {
    // On Linux/macOS: returns '/etc/passwd'
    // On Windows: path.resolve prepends the current drive (e.g. 'C:\etc\passwd')
    // Either way it must be an absolute path and match path.resolve's output
    const result = resolvePath('/etc/passwd')
    expect(result).toBe(path.resolve('/etc/passwd'))
    expect(path.isAbsolute(result)).toBe(true)
  })

  it('handles paths with trailing slash by normalizing them', () => {
    const result = resolvePath('/tmp/somedir/')
    expect(path.isAbsolute(result)).toBe(true)
  })

  it('handles empty ~ (just tilde) as home directory', () => {
    const result = resolvePath('~')
    expect(result).toBe(os.homedir())
  })
})

describe('normalizeForComparison', () => {
  it('returns a lowercase absolute path', () => {
    const result = normalizeForComparison('/Tmp/SomeFile.TXT')
    expect(result).toBe(result.toLowerCase())
    expect(path.isAbsolute(result)).toBe(true)
  })

  it('expands ~ before lowercasing', () => {
    const result = normalizeForComparison('~/.AWS/Credentials')
    expect(result).toBe(path.join(os.homedir(), '.aws', 'credentials').toLowerCase())
  })

  it('two paths pointing to the same location compare equal', () => {
    const a = normalizeForComparison('/tmp/foo/../bar')
    const b = normalizeForComparison('/tmp/bar')
    expect(a).toBe(b)
  })
})
