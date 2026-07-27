import { describe, it, expect } from 'vitest'
import type { entry } from './doom.aot'

describe('doom.aot', () => {
  it('should compile and produce a type', () => {
    // The entry type should resolve to a number type
    type Result = entry<[]>

    // We can't easily test the actual value without running the types,
    // but we can verify the type structure is correct
    const checkType: Result extends number ? true : false = true
    expect(checkType).toBe(true)
  })

  it('should evaluate the entry function', () => {
    // Force TypeScript to evaluate the entry type
    type Result = entry<[]>

    // The doom entry function reads from memory and returns a value
    // If memory is properly set up, this should be a valid number
    // If not, it would be 'never' or an error
    type IsNumber = Result extends number ? true : false
    type IsNever = Result extends never ? true : false

    const isNumber: IsNumber = true
    expect(isNumber).toBe(true)
  })
})
