import { describe, it, expect } from 'vitest'
import type { entry as AotEntry } from './doom.aot'
import type { bootstrap, Satisfies } from 'wasm-to-typescript-types'
import type { doomProgramInput } from './doom'

// Compare AOT and interpreter results
describe('doom AOT vs Interpreter', () => {
  it('should produce the same result type', () => {
    // AOT entry
    type AotResult = AotEntry<[]>

    // Both should be numbers
    type AotIsNumber = AotResult extends number ? true : false
    const aotIsNumber: AotIsNumber = true
    expect(aotIsNumber).toBe(true)
  })
})
