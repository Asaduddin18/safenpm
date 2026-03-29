/**
 * args.test.ts
 * Unit tests for parseArgs — written BEFORE implementation (TDD).
 */

import { describe, it, expect } from 'vitest'
import { parseArgs } from '../../../src/cli/args'

describe('parseArgs', () => {
  it('returns command=install with empty packages for bare "install"', () => {
    const result = parseArgs(['install'])
    expect(result.command).toBe('install')
    expect(result.packages).toEqual([])
  })

  it('returns command=install with package list', () => {
    const result = parseArgs(['install', 'express', 'lodash'])
    expect(result.command).toBe('install')
    expect(result.packages).toEqual(['express', 'lodash'])
  })

  it('returns command=help for --help flag', () => {
    expect(parseArgs(['--help']).command).toBe('help')
    expect(parseArgs(['-h']).command).toBe('help')
  })

  it('returns command=version for --version flag', () => {
    expect(parseArgs(['--version']).command).toBe('version')
    expect(parseArgs(['-v']).command).toBe('version')
  })

  it('returns command=status for "status" subcommand', () => {
    expect(parseArgs(['status']).command).toBe('status')
  })

  it('returns command=unknown for unrecognized subcommands', () => {
    const result = parseArgs(['foobar'])
    expect(result.command).toBe('unknown')
    expect(result.raw).toBe('foobar')
  })

  it('returns command=help for empty args', () => {
    expect(parseArgs([]).command).toBe('help')
  })

  it('install command supports a single package name', () => {
    const result = parseArgs(['install', 'react'])
    expect(result.packages).toEqual(['react'])
  })

  it('install command supports scoped packages', () => {
    const result = parseArgs(['install', '@aws-sdk/client-s3'])
    expect(result.packages).toEqual(['@aws-sdk/client-s3'])
  })
})
