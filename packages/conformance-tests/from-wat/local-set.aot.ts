import type { Wasm, WasmValue, Convert } from 'ts-type-math'

type $func_0_impl<> =
  Wasm.I32Add<'00000000000000000000000000001010', '00000000000000000000000000000001'>

type $entry_impl<> =
  $func_0_impl<>

export type entry<Args extends []> =
  Convert.WasmValue.ToTSNumber<
    $entry_impl<
      
    >,
    'i32'
  >
