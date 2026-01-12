import type { Wasm, WasmValue, Convert, Load } from 'ts-type-math'

type $unreachable = never

type $memory = {}

type $Load<Addr extends WasmValue> = Load.Read4Bytes<{}, $memory, Addr>

type $func_0_impl<> =
  '00000000000000000000000000101010'

type $func_1_impl<> =
  Wasm.I32Add<$func_0_impl<>, '00000000000000000000000000000001'>

type $entry_impl<> =
  $func_1_impl<>

export type entry<Args extends []> =
  Convert.WasmValue.ToTSNumber<
    $entry_impl<
      
    >,
    'i32'
  >
