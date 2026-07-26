import type { Wasm, WasmValue, Convert } from 'ts-type-math'

type $State = { memory: Record<string, string> }

type $AlignAddr<A extends WasmValue> = Wasm.I32And<A, '11111111111111111111111111111100'>

type $ByteOffset<A extends WasmValue> = Wasm.I32And<A, '00000000000000000000000000000011'>

type $ReadMem<S extends $State, A extends WasmValue> =
  $AlignAddr<A> extends infer AA extends WasmValue
    ? AA extends keyof S['memory'] ? S['memory'][AA] : '00000000000000000000000000000000'
    : never

type $LoadI32<S extends $State, A extends WasmValue> =
  $ByteOffset<A> extends '00000000000000000000000000000000'
    ? $ReadMem<S, A>
    : Wasm.I32Or<
        Wasm.I32ShrU<$ReadMem<S, A>, Wasm.I32Shl<$ByteOffset<A>, '00000000000000000000000000000011'>>,
        Wasm.I32Shl<$ReadMem<S, Wasm.I32Add<$AlignAddr<A>, '00000000000000000000000000000100'>>, Wasm.I32Sub<'00000000000000000000000000100000', Wasm.I32Shl<$ByteOffset<A>, '00000000000000000000000000000011'>>>
      >

type $Load16<S extends $State, A extends WasmValue> =
  $ByteOffset<A> extends '00000000000000000000000000000011'
    ? Wasm.I32Or<
        Wasm.I32ShrU<$ReadMem<S, A>, '00000000000000000000000000011000'>,
        Wasm.I32Shl<Wasm.I32And<$ReadMem<S, Wasm.I32Add<$AlignAddr<A>, '00000000000000000000000000000100'>>, '00000000000000000000000011111111'>, '00000000000000000000000000001000'>
      >
    : Wasm.I32And<
        Wasm.I32ShrU<$ReadMem<S, A>, Wasm.I32Shl<$ByteOffset<A>, '00000000000000000000000000000011'>>,
        '00000000000000001111111111111111'
      >

type $WriteMem<S extends $State, A extends WasmValue, V extends WasmValue> = {
  memory: S['memory'] & Record<$AlignAddr<A>, V>
}

type $Byte8Mask<Offset extends WasmValue> = Wasm.I32Shl<'00000000000000000000000011111111', Wasm.I32Shl<Offset, '00000000000000000000000000000011'>>
type $Not8Mask<Offset extends WasmValue> = Wasm.I32Xor<$Byte8Mask<Offset>, '11111111111111111111111111111111'>

type $Store8<S extends $State, Addr extends WasmValue, Val extends WasmValue> =
  $WriteMem<S, Addr, Wasm.I32Or<
    Wasm.I32And<$ReadMem<S, Addr>, $Not8Mask<$ByteOffset<Addr>>>,
    Wasm.I32Shl<Wasm.I32And<Val, '00000000000000000000000011111111'>, Wasm.I32Shl<$ByteOffset<Addr>, '00000000000000000000000000000011'>>
  >>

type $Store16<S extends $State, Addr extends WasmValue, Val extends WasmValue> =
  $ByteOffset<Addr> extends '00000000000000000000000000000011'
    ? $WriteMem<
        $WriteMem<S, Addr, Wasm.I32Or<
          Wasm.I32And<$ReadMem<S, Addr>, '00000000111111111111111111111111'>,
          Wasm.I32Shl<Wasm.I32And<Val, '00000000000000000000000011111111'>, '00000000000000000000000000011000'>
        >>,
        Wasm.I32Add<$AlignAddr<Addr>, '00000000000000000000000000000100'>,
        Wasm.I32Or<
          Wasm.I32And<$ReadMem<S, Wasm.I32Add<$AlignAddr<Addr>, '00000000000000000000000000000100'>>, '11111111111111111111111100000000'>,
          Wasm.I32ShrU<Wasm.I32And<Val, '00000000000000001111111100000000'>, '00000000000000000000000000001000'>
        >
      >
    : $WriteMem<S, Addr, Wasm.I32Or<
        Wasm.I32And<$ReadMem<S, Addr>, Wasm.I32Xor<Wasm.I32Shl<'00000000000000001111111111111111', Wasm.I32Shl<$ByteOffset<Addr>, '00000000000000000000000000000011'>>, '11111111111111111111111111111111'>>,
        Wasm.I32Shl<Wasm.I32And<Val, '00000000000000001111111111111111'>, Wasm.I32Shl<$ByteOffset<Addr>, '00000000000000000000000000000011'>>
      >>

type $Store32<S extends $State, Addr extends WasmValue, Val extends WasmValue> =
  $ByteOffset<Addr> extends '00000000000000000000000000000000'
    ? $WriteMem<S, Addr, Val>
    : $WriteMem<
        $WriteMem<S, Addr, Wasm.I32Or<
          Wasm.I32And<$ReadMem<S, Addr>, Wasm.I32Sub<Wasm.I32Shl<'00000000000000000000000000000001', Wasm.I32Shl<$ByteOffset<Addr>, '00000000000000000000000000000011'>>, '00000000000000000000000000000001'>>,
          Wasm.I32Shl<Val, Wasm.I32Shl<$ByteOffset<Addr>, '00000000000000000000000000000011'>>
        >>,
        Wasm.I32Add<$AlignAddr<Addr>, '00000000000000000000000000000100'>,
        Wasm.I32Or<
          Wasm.I32And<$ReadMem<S, Wasm.I32Add<$AlignAddr<Addr>, '00000000000000000000000000000100'>>, Wasm.I32Shl<'11111111111111111111111111111111', Wasm.I32Shl<$ByteOffset<Addr>, '00000000000000000000000000000011'>>>,
          Wasm.I32ShrU<Val, Wasm.I32Sub<'00000000000000000000000000100000', Wasm.I32Shl<$ByteOffset<Addr>, '00000000000000000000000000000011'>>>
        >
      >

type $Store64<S extends $State, Addr extends WasmValue, Val extends WasmValue> =
  $Store32<
    $Store32<S, Addr, Wasm.I32WrapI64<Val>>,
    Wasm.I32Add<Addr, '00000000000000000000000000000100'>,
    Wasm.I32WrapI64<Wasm.I64ShrU<Val, '0000000000000000000000000000000000000000000000000000000000100000'>>
  >

type $GetState<T> = T extends [infer S, any] ? S : T
type $GetValue<T> = T extends [any, infer V] ? V : never

type $clear<$S extends $State, $p0 extends WasmValue> =
  $Store8<$S, Wasm.I32Add<$p0, '00000000000000000010000000000000'>, '00000000000000000000000000100000'> extends infer $S1 extends $State
    ? Wasm.I32Add<$p0, '00000000000000000000000000000001'> extends infer $p1 extends WasmValue
      ? Wasm.I32Neq<$p1, '00000000000000000000000000111100'> extends '00000000000000000000000000000000'
        ? [$S1, $p1]
        : $clear<$S1, $p1>
      : never
    : never

type $Run = $clear<{ memory: {} }, '00000000000000000000000000110100'>
type $Mem = $GetState<$Run>
type $Byte<A extends WasmValue> =
  Wasm.I32And<Wasm.I32ShrU<$ReadMem<$Mem & $State, A>, Wasm.I32Shl<$ByteOffset<A>, '00000000000000000000000000000011'>>, '00000000000000000000000011111111'>

export type BenchResult = `${Convert.WasmValue.ToTSNumber<$GetValue<$Run> & string, 'i32'>}|${Convert.WasmValue.ToTSNumber<$Byte<'00000000000000000010000000110100'>, 'i32'>}|${Convert.WasmValue.ToTSNumber<$Byte<'00000000000000000010000000111000'>, 'i32'>}|${Convert.WasmValue.ToTSNumber<$Byte<'00000000000000000010000000111011'>, 'i32'>}`
