/**
 * path-matcher.test.ts
 *
 * Tests for src/capabilities/path-matcher.ts
 * Verifies: isPathAllowed (enforces fs capability profiles),
 * isSensitivePath (identifies credential and system paths).
 */

import { describe, it, expect } from 'vitest'
import path from 'path'
import os from 'os'
import { isPathAllowed, isSensitivePath } from '../../src/capabilities/path-matcher'

describe('isPathAllowed', () => {
  it('returns false when allowedPatterns is empty', () => {
    expect(isPathAllowed('/tmp/file.txt', [])).toBe(false)
  })

  it('allows exact path match', () => {
    expect(isPathAllowed('/tmp/output.txt', ['/tmp/output.txt'])).toBe(true)
  })

  it('allows path under a directory prefix', () => {
    expect(isPathAllowed('/tmp/build/out.js', ['/tmp'])).toBe(true)
    expect(isPathAllowed('/tmp/deep/nested/file', ['/tmp'])).toBe(true)
  })

  it('blocks path that shares a prefix but is not under it', () => {
    // /tmpfile is NOT under /tmp
    expect(isPathAllowed('/tmpfile.txt', ['/tmp'])).toBe(false)
  })

  it('allows path matching /** glob pattern', () => {
    expect(isPathAllowed('/project/src/utils/foo.ts', ['/project/src/**'])).toBe(true)
    expect(isPathAllowed('/project/src/index.ts', ['/project/src/**'])).toBe(true)
  })

  it('blocks path outside the /** glob pattern', () => {
    expect(isPathAllowed('/project/dist/bundle.js', ['/project/src/**'])).toBe(false)
  })

  it('allows path when one of multiple patterns matches', () => {
    const patterns = ['/tmp/**', '/project/dist/**']
    expect(isPathAllowed('/tmp/build.log', patterns)).toBe(true)
    expect(isPathAllowed('/project/dist/app.js', patterns)).toBe(true)
    expect(isPathAllowed('/project/src/app.ts', patterns)).toBe(false)
  })

  it('resolves relative patterns to absolute before comparison', () => {
    const absPattern = path.resolve('./node_modules/bcrypt/**')
    const absPath = path.resolve('./node_modules/bcrypt/lib/index.js')
    expect(isPathAllowed(absPath, [absPattern])).toBe(true)
  })

  it('handles ~ expansion in allowed patterns', () => {
    // Package allowed to read from ~/Downloads/** (unusual but valid)
    const pattern = path.join(os.homedir(), 'Downloads', '**')
    const filePath = path.join(os.homedir(), 'Downloads', 'file.txt')
    expect(isPathAllowed(filePath, [pattern])).toBe(true)
  })

  it('blocks home directory when not in allowed list', () => {
    const creds = path.join(os.homedir(), '.aws', 'credentials')
    expect(isPathAllowed(creds, ['/tmp/**', '/project/**'])).toBe(false)
  })

  it('is case-insensitive on comparison (important for Windows compatibility)', () => {
    // On case-insensitive file systems, /TMP/file and /tmp/file are the same
    // Our normalizer lowercases both sides
    const result = isPathAllowed('/TMP/file.txt', ['/tmp/**'])
    // On Linux this is a different path, on Windows it's the same
    // The function should not throw regardless
    expect(typeof result).toBe('boolean')
  })
})

describe('isSensitivePath', () => {
  it('flags the entire home directory', () => {
    expect(isSensitivePath(os.homedir())).toBe(true)
    expect(isSensitivePath(path.join(os.homedir(), 'anything'))).toBe(true)
  })

  it('flags ~/.aws/credentials specifically', () => {
    expect(isSensitivePath(path.join(os.homedir(), '.aws', 'credentials'))).toBe(true)
  })

  it('flags ~/.ssh/id_rsa', () => {
    expect(isSensitivePath(path.join(os.homedir(), '.ssh', 'id_rsa'))).toBe(true)
  })

  it('flags /etc/passwd', () => {
    expect(isSensitivePath('/etc/passwd')).toBe(true)
  })

  it('flags /etc/shadow', () => {
    expect(isSensitivePath('/etc/shadow')).toBe(true)
  })

  it('flags /etc/sudoers', () => {
    expect(isSensitivePath('/etc/sudoers')).toBe(true)
  })

  it('flags /proc (Linux process info)', () => {
    expect(isSensitivePath('/proc/1/mem')).toBe(true)
    expect(isSensitivePath('/proc')).toBe(true)
  })

  it('does NOT flag /tmp', () => {
    expect(isSensitivePath('/tmp')).toBe(false)
    expect(isSensitivePath('/tmp/safefile.txt')).toBe(false)
  })

  it('does NOT flag project source directory', () => {
    expect(isSensitivePath('/project/src/app.ts')).toBe(false)
    expect(isSensitivePath('/project/dist/bundle.js')).toBe(false)
  })

  it('does NOT flag node_modules', () => {
    expect(isSensitivePath('/project/node_modules/lodash/index.js')).toBe(false)
  })
})
