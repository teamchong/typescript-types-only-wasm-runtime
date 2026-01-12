import type { Wasm, WasmValue, Convert } from 'ts-type-math'

type $State = { memory: Record<string, string> }

type $AlignAddr<A extends WasmValue> = Wasm.I32And<A, '11111111111111111111111111111100'>

type $ReadMem<S extends $State, A extends WasmValue> =
  $AlignAddr<A> extends infer AA extends WasmValue
    ? AA extends keyof S['memory'] ? S['memory'][AA] : '00000000000000000000000000000000'
    : never

type $WriteMem<S extends $State, A extends WasmValue, V extends WasmValue> = {
  memory: S['memory'] & Record<$AlignAddr<A>, V>
}

type $GetState<T> = T extends [infer S, any] ? S : T
type $GetValue<T> = T extends [any, infer V] ? V : never

type $InitialMemory = {
}

type $InitialState = { memory: $InitialMemory }

type $func_0_impl<$S extends $State, $p0 extends WasmValue, $p1 extends WasmValue> =
  [$S, Wasm.I32Add<$p0, $p1>]

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
