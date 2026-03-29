/**
 * profiler-scans-node-modules.test.ts
 * Integration: profiler orchestrator scans a fake node_modules dir and
 * returns a CapabilitiesFile with one entry per installed package.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { profileProject } from '../../src/profiler/index'

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'safenpm-profiler-itest-'))
}

function makePackage(root: string, name: string, version = '1.0.0'): void {
  const dir = path.join(root, 'node_modules', name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version }), 'utf8')
  fs.writeFileSync(path.join(dir, 'index.js'), `module.exports = {}`, 'utf8')
}

describe('profiler — scans node_modules (integration)', () => {
  let tmpDir: string

  beforeEach(() => { tmpDir = makeTmpDir() })
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }) })

  it('returns a CapabilitiesFile with one entry per installed package', async () => {
    makePackage(tmpDir, 'lodash', '4.17.21')
    makePackage(tmpDir, 'chalk', '5.3.0')

    const caps = await profileProject(tmpDir)

    expect(caps.version).toBe('1.0')
    expect(caps.projectRoot).toBe(tmpDir)
    expect(Object.keys(caps.packages)).toHaveLength(2)
    expect(caps.packages['lodash']).toBeDefined()
    expect(caps.packages['chalk']).toBeDefined()
  })

  it('each package entry has correct version from package.json', async () => {
    makePackage(tmpDir, 'express', '4.18.2')

    const caps = await profileProject(tmpDir)

    expect(caps.packages['express'].version).toBe('4.18.2')
  })

  it('detects native modules when a .node file is present', async () => {
    makePackage(tmpDir, 'native-addon', '1.0.0')
    const nodeFile = path.join(tmpDir, 'node_modules', 'native-addon', 'build', 'addon.node')
    fs.mkdirSync(path.dirname(nodeFile), { recursive: true })
    fs.writeFileSync(nodeFile, '', 'utf8')

    const caps = await profileProject(tmpDir)

    expect(caps.packages['native-addon'].hasNativeModules).toBe(true)
  })

  it('non-native packages have hasNativeModules=false', async () => {
    makePackage(tmpDir, 'pure-js-pkg', '2.0.0')

    const caps = await profileProject(tmpDir)

    expect(caps.packages['pure-js-pkg'].hasNativeModules).toBe(false)
  })

  it('returns empty packages object when node_modules is absent', async () => {
    const caps = await profileProject(tmpDir)
    expect(Object.keys(caps.packages)).toHaveLength(0)
  })

  it('profiles include all-deny defaults (no access by default)', async () => {
    makePackage(tmpDir, 'untrusted-pkg', '1.0.0')

    const caps = await profileProject(tmpDir)
    const profile = caps.packages['untrusted-pkg']

    expect(profile.fs.read).toEqual([])
    expect(profile.fs.write).toEqual([])
    expect(profile.net.outbound).toBe(false)
    expect(profile.env).toEqual([])
    expect(profile.child_process.allowed).toBe(false)
  })
})
