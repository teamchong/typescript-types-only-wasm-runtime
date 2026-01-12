import type { Wasm, WasmValue, Convert } from 'ts-type-math'

// State type containing memory
type $State = { memory: Record<string, string> }

// Align address to 4-byte boundary
type $AlignAddr<Addr extends WasmValue> = Wasm.I32And<Addr, '11111111111111111111111111111100'>

// Read 4 bytes from memory at aligned address
type $ReadMem<S extends $State, Addr extends WasmValue> = 
  $AlignAddr<Addr> extends infer AlignedAddr extends WasmValue
    ? AlignedAddr extends keyof S['memory'] 
      ? S['memory'][AlignedAddr]
      : '00000000000000000000000000000000'
    : never

// Write 4 bytes to memory - returns new state
type $WriteMem<S extends $State, Addr extends WasmValue, Value extends WasmValue> = {
  memory: S['memory'] & Record<$AlignAddr<Addr>, Value>
}

// Extract state from [State, Value] tuple
type $GetState<T> = T extends [infer S, any] ? S : T

// Extract value from [State, Value] tuple
type $GetValue<T> = T extends [any, infer V] ? V : never

// Initial memory from data section (4-byte chunks)
type $InitialMemory = {
}

type $InitialState = { memory: $InitialMemory }

type $func_0_impl<$S extends $State, $p0 extends WasmValue, $p1 extends WasmValue> =
  [(Wasm.I32GeS<$p1, '00000000000000000000000000000000'> extends '00000000000000000000000000000000' ? [$S, '11111111111111111111111111111111'] : [$S, '00000000000000000000000000000001']), Wasm.I32Add<$p0, (Wasm.I32GeS<$p1, '00000000000000000000000000000000'> extends '00000000000000000000000000000000' ? '11111111111111111111111111111111' : '00000000000000000000000000000001')>]

type $entry_impl<$S extends $State, $p0 extends WasmValue, $p1 extends WasmValue> =
  [$GetState<$func_0_impl<$S, $p0, $p1>>, $GetValue<$func_0_impl<$S, $p0, $p1>>]

export type entry<Args extends [number, number]> =
  Convert.WasmValue.ToTSNumber<
    $GetValue<$entry_impl<
      $InitialState,
      Convert.U32Decimal.ToU32Binary<Args[0]>,
      Convert.U32Decimal.ToU32Binary<Args[1]>
    >>,
    'i32'
  >
