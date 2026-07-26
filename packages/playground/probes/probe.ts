// Probe: how deep can a tail-recursive type-level wasm loop go?
import type { Wasm, WasmValue, Convert } from 'ts-type-math'

type ZERO = '00000000000000000000000000000000'
type ONE  = '00000000000000000000000000000001'

type Count<N extends WasmValue, Acc extends WasmValue> =
  N extends ZERO ? Acc : Count<Wasm.I32Sub<N, ONE>, Wasm.I32Add<Acc, ONE>>

type N = '__N__'
export type BenchResult = Convert.WasmValue.ToTSNumber<Count<N, ZERO>, 'i32'>
