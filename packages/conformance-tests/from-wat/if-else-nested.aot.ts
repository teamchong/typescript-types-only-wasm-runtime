import type { Wasm, WasmValue, Convert } from 'ts-type-math'

type $unreachable = never

type $func_0_impl<$p0 extends WasmValue, $p1 extends WasmValue> =
  (Wasm.I32Eq<$p1, '00000000000000000000000000000001'> extends '00000000000000000000000000000000' ? (Wasm.I32Eq<$p1, '00000000000000000000000000000010'> extends '00000000000000000000000000000000' ? (Wasm.I32GeS<$p1, '00000000000000000000000000000011'> extends '00000000000000000000000000000000' ? Wasm.I32Add<'00000000000000000000000001101001', $p0> : (Wasm.I32GtS<$p1, '00000000000000000000000000000101'> extends '00000000000000000000000000000000' ? Wasm.I32Add<'00000000000000000000000001101000', $p0> : Wasm.I32Mul<'00000000000000000000000001100111', $p0>)) : Wasm.I32Sub<'00000000000000000000000001100110', $p0>) : Wasm.I32Add<'00000000000000000000000001100101', $p0>)

type $entry_impl<$p0 extends WasmValue, $p1 extends WasmValue> =
  $func_0_impl<$p0, $p1>

export type entry<Args extends [number, number]> =
  Convert.WasmValue.ToTSNumber<
    $entry_impl<
      Convert.U32Decimal.ToU32Binary<Args[0]>,
      Convert.U32Decimal.ToU32Binary<Args[1]>
    >,
    'i32'
  >
