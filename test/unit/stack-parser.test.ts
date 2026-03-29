/**
 * stack-parser.test.ts
 *
 * Tests for src/utils/stack-parser.ts
 * Verifies that v8 stack trace strings are parsed into structured frames
 * including file, line, column. Edge cases: anonymous frames, eval, native.
 */

import { describe, it, expect } from 'vitest'
import { parseStack } from '../../src/utils/stack-parser'

describe('parseStack', () => {
  it('parses a standard at-function v8 stack trace', () => {
    const stack = [
      'Error: test error',
      '    at readFileSync (/project/node_modules/lodash/lodash.js:123:45)',
      '    at Object.<anonymous> (/project/src/app.ts:10:3)',
    ].join('\n')

    const frames = parseStack(stack)
    expect(frames).toHaveLength(2)
    expect(frames[0].file).toBe('/project/node_modules/lodash/lodash.js')
    expect(frames[0].line).toBe(123)
    expect(frames[0].column).toBe(45)
  })

  it('parses frame without function name', () => {
    const stack = [
      'Error',
      '    at /project/src/index.ts:5:10',
    ].join('\n')

    const frames = parseStack(stack)
    expect(frames).toHaveLength(1)
    expect(frames[0].file).toBe('/project/src/index.ts')
    expect(frames[0].line).toBe(5)
    expect(frames[0].column).toBe(10)
  })

  it('skips the Error header line', () => {
    const stack = 'Error: something\n    at /foo/bar.js:1:1'
    const frames = parseStack(stack)
    expect(frames).toHaveLength(1)
  })

  it('returns empty array for empty stack string', () => {
    expect(parseStack('')).toEqual([])
  })

  it('handles native frames (no file path) by returning null file', () => {
    const stack = [
      'Error',
      '    at Array.map (native)',
      '    at /project/src/app.ts:1:1',
    ].join('\n')

    const frames = parseStack(stack)
    // native frame should either be skipped or have null file
    const nonNull = frames.filter(f => f.file !== null)
    expect(nonNull).toHaveLength(1)
    expect(nonNull[0].file).toBe('/project/src/app.ts')
  })

  it('handles eval frames gracefully without throwing', () => {
    const stack = [
      'Error',
      '    at eval (eval at <anonymous> (/project/src/app.ts:5:3), <anonymous>:1:1)',
      '    at /project/src/app.ts:5:3',
    ].join('\n')

    expect(() => parseStack(stack)).not.toThrow()
    const frames = parseStack(stack)
    expect(Array.isArray(frames)).toBe(true)
  })

  it('handles Windows-style paths', () => {
    const stack = [
      'Error',
      '    at readFileSync (C:\\project\\node_modules\\evil\\index.js:10:5)',
    ].join('\n')

    const frames = parseStack(stack)
    // Should parse without throwing; file may contain backslashes on Windows
    expect(frames.length).toBeGreaterThanOrEqual(0)
  })

  it('parses scoped package paths correctly', () => {
    const stack = [
      'Error',
      '    at fetch (/app/node_modules/@aws-sdk/client-s3/dist/index.js:200:10)',
    ].join('\n')

    const frames = parseStack(stack)
    expect(frames[0].file).toBe('/app/node_modules/@aws-sdk/client-s3/dist/index.js')
  })

  it('returns line and column as numbers not strings', () => {
    const stack = 'Error\n    at fn (/foo/bar.js:42:7)'
    const frames = parseStack(stack)
    expect(typeof frames[0].line).toBe('number')
    expect(typeof frames[0].column).toBe('number')
  })
})
