import type { Wasm, WasmValue, Convert } from 'ts-type-math'

type $func_0_impl<$p0 extends WasmValue> =
  Wasm.I32Add<$p0, $p0>

type $entry_impl<$p0 extends WasmValue> =
  $func_0_impl<$p0>

export type entry<Args extends [number]> =
  Convert.WasmValue.ToTSNumber<
    $entry_impl<
      Convert.U32Decimal.ToU32Binary<Args[0]>
    >,
    'i32'
  >
