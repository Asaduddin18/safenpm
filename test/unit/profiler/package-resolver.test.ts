/**
 * package-resolver.test.ts
 * Unit tests for resolveInstalledPackages — written BEFORE implementation (TDD).
 *
 * resolveInstalledPackages(root) reads <root>/node_modules and returns a flat
 * list of every installed package with its name, version, and directory path.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveInstalledPackages } from '../../../src/profiler/package-resolver'

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'safenpm-resolver-'))
}

/** Create a fake package inside node_modules with a minimal package.json */
function makePackage(
  root: string,
  name: string,
  version = '1.0.0'
): string {
  const pkgDir = path.join(root, 'node_modules', name)
  fs.mkdirSync(pkgDir, { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name, version }),
    'utf8'
  )
  return pkgDir
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('resolveInstalledPackages', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns empty array when node_modules does not exist', () => {
    const result = resolveInstalledPackages(tmpDir)
    expect(result).toEqual([])
  })

  it('returns empty array for an empty node_modules directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'node_modules'))
    const result = resolveInstalledPackages(tmpDir)
    expect(result).toEqual([])
  })

  it('returns one entry for a single installed package', () => {
    const pkgDir = makePackage(tmpDir, 'lodash', '4.17.21')
    const result = resolveInstalledPackages(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ name: 'lodash', version: '4.17.21', pkgDir })
  })

  it('returns multiple entries for multiple packages', () => {
    makePackage(tmpDir, 'express', '4.18.0')
    makePackage(tmpDir, 'axios', '1.6.0')
    const result = resolveInstalledPackages(tmpDir)
    expect(result).toHaveLength(2)
    const names = result.map(r => r.name).sort()
    expect(names).toEqual(['axios', 'express'])
  })

  it('handles scoped packages (@scope/name)', () => {
    makePackage(tmpDir, '@aws-sdk/client-s3', '3.400.0')
    const result = resolveInstalledPackages(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('@aws-sdk/client-s3')
  })

  it('skips entries without a package.json (broken installs)', () => {
    // directory with no package.json
    fs.mkdirSync(path.join(tmpDir, 'node_modules', 'broken-pkg'), { recursive: true })
    // valid package alongside it
    makePackage(tmpDir, 'valid-pkg', '1.0.0')
    const result = resolveInstalledPackages(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('valid-pkg')
  })

  it('skips .bin and other dot-directories', () => {
    makePackage(tmpDir, 'real-pkg', '1.0.0')
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '.bin'), { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'node_modules', '.cache'), { recursive: true })
    const result = resolveInstalledPackages(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('real-pkg')
  })

  it('reads version from package.json even if name differs from directory name', () => {
    // Some packages have different directory names after deduplication
    const pkgDir = path.join(tmpDir, 'node_modules', 'some-dir')
    fs.mkdirSync(pkgDir, { recursive: true })
    fs.writeFileSync(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'actual-pkg-name', version: '2.0.0' }),
      'utf8'
    )
    const result = resolveInstalledPackages(tmpDir)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('actual-pkg-name')
    expect(result[0].version).toBe('2.0.0')
  })
})
