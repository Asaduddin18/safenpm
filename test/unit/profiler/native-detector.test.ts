/**
 * native-detector.test.ts
 * Unit tests for hasNativeModules — written BEFORE implementation (TDD).
 *
 * A "native module" is a compiled .node file (N-API/nan addon).
 * If a package ships one, it gets elevated risk in the capability profile.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { hasNativeModules } from '../../../src/profiler/native-detector'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'safenpm-native-'))
}

function touchFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, '', 'utf8')
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('hasNativeModules', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns false for a directory with no .node files', () => {
    touchFile(path.join(tmpDir, 'index.js'))
    touchFile(path.join(tmpDir, 'lib', 'helper.js'))
    expect(hasNativeModules(tmpDir)).toBe(false)
  })

  it('returns true when a .node file exists at top level', () => {
    touchFile(path.join(tmpDir, 'binding.node'))
    expect(hasNativeModules(tmpDir)).toBe(true)
  })

  it('returns true when a .node file is nested in a subdirectory', () => {
    touchFile(path.join(tmpDir, 'build', 'Release', 'addon.node'))
    expect(hasNativeModules(tmpDir)).toBe(true)
  })

  it('returns false for a non-existent directory (does not throw)', () => {
    const missing = path.join(tmpDir, 'does-not-exist')
    expect(hasNativeModules(missing)).toBe(false)
  })

  it('ignores files named .node-something (must end in .node)', () => {
    touchFile(path.join(tmpDir, 'index.node-gyp-build'))
    expect(hasNativeModules(tmpDir)).toBe(false)
  })

  it('returns true for deeply nested .node file (3+ levels deep)', () => {
    touchFile(path.join(tmpDir, 'prebuilds', 'linux-x64', 'node.abi83', 'addon.node'))
    expect(hasNativeModules(tmpDir)).toBe(true)
  })
})
