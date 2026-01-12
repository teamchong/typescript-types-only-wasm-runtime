import type { Expect, Equal } from 'type-testing';
import type { entry as interpreterEntry } from './add'
import type { entry as aotEntry } from './add.aot'

// Compare AOT output vs Interpreter output for add.wasm
// Both should produce identical results for all inputs

type tests = [
  // Basic cases
  Expect<Equal<aotEntry<[0, 0]>, interpreterEntry<[0, 0]>>>,
  Expect<Equal<aotEntry<[1, 1]>, interpreterEntry<[1, 1]>>>,
  Expect<Equal<aotEntry<[5, 3]>, interpreterEntry<[5, 3]>>>,
  Expect<Equal<aotEntry<[10, 20]>, interpreterEntry<[10, 20]>>>,
  Expect<Equal<aotEntry<[100, 200]>, interpreterEntry<[100, 200]>>>,

  // Verify actual values
  Expect<Equal<aotEntry<[5, 3]>, 8>>,
  Expect<Equal<aotEntry<[0, 0]>, 0>>,
  Expect<Equal<aotEntry<[1, 1]>, 2>>,
]

// Debug: show actual types
type debug_aot = aotEntry<[5, 3]>      // => should be 8
type debug_interp = interpreterEntry<[5, 3]>  // => should be 8
