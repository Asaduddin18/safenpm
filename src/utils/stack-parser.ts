/**
 * stack-parser.ts
 *
 * Parses a v8-format Error.stack string into structured StackFrame objects.
 * Used by caller-resolver to identify which package triggered a module load.
 *
 * v8 stack frame formats:
 *   at FunctionName (file:line:col)     — named function
 *   at file:line:col                     — anonymous / top-level
 *   at FunctionName (native)             — native built-in
 *   at eval (eval at <anonymous> ...)    — eval
 */

export interface StackFrame {
  /** Absolute file path, or null for native/eval frames. */
  file: string | null
  /** Line number (1-based), or null if not parseable. */
  line: number | null
  /** Column number (1-based), or null if not parseable. */
  column: number | null
  /** The raw frame string for debugging. */
  raw: string
}

/**
 * Parses a v8 Error.stack string into an array of StackFrames.
 * The first line ("Error: message") is always skipped.
 * Frames with no parseable file path get file: null.
 */
export function parseStack(errorStack: string): StackFrame[] {
  if (!errorStack) return []

  const lines = errorStack.split('\n').slice(1) // drop "Error: ..." header

  return lines
    .map(line => parseFrame(line.trim()))
    .filter((f): f is StackFrame => f !== null)
}

function parseFrame(line: string): StackFrame | null {
  if (!line.startsWith('at ')) return null

  // Pattern 1: at FunctionName (file:line:col)
  const withFn = line.match(/^at .+? \((.+):(\d+):(\d+)\)$/)
  if (withFn) {
    const file = withFn[1]
    // Skip native frames and internal node frames
    if (file === 'native' || file.startsWith('<')) {
      return { file: null, line: null, column: null, raw: line }
    }
    return {
      file: normalizeFilePath(file),
      line: parseInt(withFn[2], 10),
      column: parseInt(withFn[3], 10),
      raw: line,
    }
  }

  // Pattern 2: at file:line:col (no function name)
  const withoutFn = line.match(/^at (.+):(\d+):(\d+)$/)
  if (withoutFn) {
    return {
      file: normalizeFilePath(withoutFn[1]),
      line: parseInt(withoutFn[2], 10),
      column: parseInt(withoutFn[3], 10),
      raw: line,
    }
  }

  // Pattern 3: native or unrecognized — return with null file
  return { file: null, line: null, column: null, raw: line }
}

/**
 * Normalizes Windows backslash paths to forward slashes for consistent
 * regex matching in caller-resolver.
 */
function normalizeFilePath(filePath: string): string {
  return filePath.replace(/\\/g, '/')
}
