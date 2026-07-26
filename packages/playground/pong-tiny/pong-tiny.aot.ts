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

type $InitialMemory = {
  '00000000000000000010000000000100': '00000000000000000000000000010100',
  '00000000000000000010000000001000': '00000000000000000000000000001100',
  '00000000000000000010000000001100': '00000000000000000000000000000001',
  '00000000000000000010000000010000': '00000000000000000000000000000001',
  '00000000000000000010000000010100': '00000000000000000000000000001010',
  '00000000000000000010000000011000': '00000000000000000000000000001010',
  '00000000000000000010000000011100': '00000000000000000000000000010100',
  '00000000000000000010000000100000': '00000000000000000000000000001100',
  '00000000000000000010000000100100': '00000000000000000000000000001010',
  '00000000000000000010000000101000': '00000000000000000000000000001010',
}

type $InitialState = { memory: $InitialMemory }

type $g0 = '00000000000000000010000000000000'

type $loop_0_0<$S extends $State, $p0 extends WasmValue, $l0_1 extends WasmValue, $l0_2 extends WasmValue, $l0_3 extends WasmValue, $l0_4 extends WasmValue, $l0_5 extends WasmValue, $l0_6 extends WasmValue, $l0_7 extends WasmValue, $l0_8 extends WasmValue, $l0_9 extends WasmValue, $l0_10 extends WasmValue, $l0_11 extends WasmValue, $l0_12 extends WasmValue, $l0_13 extends WasmValue> =
  Wasm.I32Neq<Wasm.I32Add<'00000000000000000000000000110100', '00000000000000000000000000000001'>, '00000000000000000000001111110100'> extends '00000000000000000000000000000000' ? [$S, $l0_13] : $loop_0_0<$S, $p0, $l0_1, $l0_2, $l0_3, $l0_4, $l0_5, $l0_6, $l0_7, $l0_8, $l0_9, $l0_10, $l0_11, $l0_12, $l0_13>

type $loop_0_1<$S extends $State, $p0 extends WasmValue, $l1_1 extends WasmValue, $l1_2 extends WasmValue, $l1_3 extends WasmValue, $l1_4 extends WasmValue, $l1_5 extends WasmValue, $l1_6 extends WasmValue, $l1_7 extends WasmValue, $l1_8 extends WasmValue, $l1_9 extends WasmValue, $l1_10 extends WasmValue, $l1_11 extends WasmValue, $l1_12 extends WasmValue, $l1_13 extends WasmValue> =
  Wasm.I32Neq<Wasm.I32Add<'00000000000000000000000001001000', '00000000000000000000000000101000'>, '00000000000000000000010000001000'> extends '00000000000000000000000000000000' ? [$S, $l1_13] : $loop_0_1<$S, $p0, $l1_1, $l1_2, $l1_3, $l1_4, $l1_5, $l1_6, $l1_7, $l1_8, $l1_9, $l1_10, $l1_11, $l1_12, $l1_13>

type $v0_0<$S extends $State, $p0 extends WasmValue> =
  $LoadI32<$Store32<$Store8<$Store8<$S, Wasm.I32Add<'00000000000000000000000000110100', '00000000000000000010000000000000'>, '00000000000000000000000000100000'>, Wasm.I32Add<'00000000000000000000000001001000', '00000000000000000010000000000000'>, '00000000000000000000000001111100'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000000000'>, '00000000000000000000000000000001'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000010100'>>

type $loop_0_2<$S extends $State, $p0 extends WasmValue, $l2_1 extends WasmValue, $l2_2 extends WasmValue, $l2_3 extends WasmValue, $l2_4 extends WasmValue, $l2_5 extends WasmValue, $l2_6 extends WasmValue, $l2_7 extends WasmValue, $l2_8 extends WasmValue, $l2_9 extends WasmValue, $l2_10 extends WasmValue, $l2_11 extends WasmValue, $l2_12 extends WasmValue, $l2_13 extends WasmValue> =
  Wasm.I32Neq<Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000000000000000001'>, '00000000000000000000000000000100'> extends '00000000000000000000000000000000' ? [$S, $l2_13] : $loop_0_2<$S, $p0, $l2_1, Wasm.I32Add<$l2_2, '00000000000000000000000000101000'>, $l2_3, $l2_4, $l2_5, $l2_6, $l2_7, $l2_8, $l2_9, $l2_10, $l2_11, $l2_12, $l2_13>

type $v0_1<$S extends $State, $p0 extends WasmValue> =
  $LoadI32<$Store32<$Store8<$Store8<$S, Wasm.I32Add<'00000000000000000000000000110100', '00000000000000000010000000000000'>, '00000000000000000000000000100000'>, Wasm.I32Add<'00000000000000000000000001001000', '00000000000000000010000000000000'>, '00000000000000000000000001111100'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000000000'>, '00000000000000000000000000000001'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000011000'>>

type $loop_0_3<$S extends $State, $p0 extends WasmValue, $l3_1 extends WasmValue, $l3_2 extends WasmValue, $l3_3 extends WasmValue, $l3_4 extends WasmValue, $l3_5 extends WasmValue, $l3_6 extends WasmValue, $l3_7 extends WasmValue, $l3_8 extends WasmValue, $l3_9 extends WasmValue, $l3_10 extends WasmValue, $l3_11 extends WasmValue, $l3_12 extends WasmValue, $l3_13 extends WasmValue> =
  Wasm.I32Neq<Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000000000000000001'>, '00000000000000000000000000000100'> extends '00000000000000000000000000000000' ? [$S, $l3_13] : $loop_0_3<$S, $p0, $l3_1, Wasm.I32Add<$l3_2, '00000000000000000000000000101000'>, $l3_3, $l3_4, $l3_5, $l3_6, $l3_7, $l3_8, $l3_9, $l3_10, $l3_11, $l3_12, $l3_13>

type $v0_2<$S extends $State, $p0 extends WasmValue> =
  $LoadI32<$Store32<$Store8<$Store8<$S, Wasm.I32Add<'00000000000000000000000000110100', '00000000000000000010000000000000'>, '00000000000000000000000000100000'>, Wasm.I32Add<'00000000000000000000000001001000', '00000000000000000010000000000000'>, '00000000000000000000000001111100'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000000000'>, '00000000000000000000000000000001'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000001000'>>

type $v0_3<$S extends $State, $p0 extends WasmValue> =
  $LoadI32<$Store32<$Store8<$Store8<$S, Wasm.I32Add<'00000000000000000000000000110100', '00000000000000000010000000000000'>, '00000000000000000000000000100000'>, Wasm.I32Add<'00000000000000000000000001001000', '00000000000000000010000000000000'>, '00000000000000000000000001111100'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000000000'>, '00000000000000000000000000000001'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000000100'>>

type $v0_4<$S extends $State, $p0 extends WasmValue, $l4_1 extends WasmValue, $l4_2 extends WasmValue, $l4_3 extends WasmValue, $l4_4 extends WasmValue, $l4_5 extends WasmValue, $l4_6 extends WasmValue, $l4_7 extends WasmValue, $l4_8 extends WasmValue, $l4_9 extends WasmValue, $l4_10 extends WasmValue, $l4_11 extends WasmValue, $l4_12 extends WasmValue, $l4_13 extends WasmValue> =
  Wasm.I32Add<Wasm.I32Mul<Wasm.I32Add<'00000000000000000000000000000000', $l4_3>, '00000000000000000000000000101000'>, $l4_4>

type $loop_0_5<$S extends $State, $p0 extends WasmValue, $l4_1 extends WasmValue, $l4_2 extends WasmValue, $l4_3 extends WasmValue, $l4_4 extends WasmValue, $l4_5 extends WasmValue, $l4_6 extends WasmValue, $l4_7 extends WasmValue, $l4_8 extends WasmValue, $l4_9 extends WasmValue, $l4_10 extends WasmValue, $l4_11 extends WasmValue, $l4_12 extends WasmValue, $l4_13 extends WasmValue, $l5_1 extends WasmValue, $l5_2 extends WasmValue, $l5_3 extends WasmValue, $l5_4 extends WasmValue, $l5_5 extends WasmValue, $l5_6 extends WasmValue, $l5_7 extends WasmValue, $l5_8 extends WasmValue, $l5_9 extends WasmValue, $l5_10 extends WasmValue, $l5_11 extends WasmValue, $l5_12 extends WasmValue, $l5_13 extends WasmValue> =
  Wasm.I32And<$l5_2, '00000000000000000000000000000001'> extends '00000000000000000000000000000000' ? [$S, $l5_13] : $loop_0_5<$S, $p0, $l4_1, $l4_2, $l4_3, $l4_4, $l4_5, $l4_6, $l4_7, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $l4_13, Wasm.I32And<$l5_2, '00000000000000000000000000000001'>, '00000000000000000000000000000000', $l5_3, $l5_4, $l5_5, $l5_6, $l5_7, $l5_8, $l5_9, $l5_10, $l5_11, $l5_12, $l5_13>

type $loop_0_4<$S extends $State, $p0 extends WasmValue, $l4_1 extends WasmValue, $l4_2 extends WasmValue, $l4_3 extends WasmValue, $l4_4 extends WasmValue, $l4_5 extends WasmValue, $l4_6 extends WasmValue, $l4_7 extends WasmValue, $l4_8 extends WasmValue, $l4_9 extends WasmValue, $l4_10 extends WasmValue, $l4_11 extends WasmValue, $l4_12 extends WasmValue, $l4_13 extends WasmValue> =
  Wasm.I32And<$l4_5, '00000000000000000000000000000001'> extends '00000000000000000000000000000000' ? [$S, $GetValue<$loop_0_5<$Store32<$Store8<$Store8<$S, Wasm.I32Add<'00000000000000000000000000110100', '00000000000000000010000000000000'>, '00000000000000000000000000100000'>, Wasm.I32Add<'00000000000000000000000001001000', '00000000000000000010000000000000'>, '00000000000000000000000001111100'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000000000'>, '00000000000000000000000000000001'>, $p0, $l4_1, $l4_2, $l4_3, $l4_4, $l4_5, $l4_6, $l4_7, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $l4_13, $l4_1, '00000000000000000000000000000001', $l4_3, $l4_4, $l4_5, $v0_4<$S, $p0, $l4_1, $l4_2, $l4_3, $l4_4, $l4_5, $l4_6, $l4_7, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $l4_13>, Wasm.I32GtU<Wasm.I32Add<'00000000000000000000000000000000', $l4_3>, '00000000000000000000000000010111'>, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $l4_13>>] : $loop_0_4<$S, $p0, $l4_1, Wasm.I32And<$l4_5, '00000000000000000000000000000001'>, $l4_3, $l4_4, '00000000000000000000000000000000', $v0_4<$S, $p0, $l4_1, $l4_2, $l4_3, $l4_4, $l4_5, $l4_6, $l4_7, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $l4_13>, Wasm.I32GtU<Wasm.I32Add<'00000000000000000000000000000000', $l4_3>, '00000000000000000000000000010111'>, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $GetValue<$loop_0_5<$Store32<$Store8<$Store8<$S, Wasm.I32Add<'00000000000000000000000000110100', '00000000000000000010000000000000'>, '00000000000000000000000000100000'>, Wasm.I32Add<'00000000000000000000000001001000', '00000000000000000010000000000000'>, '00000000000000000000000001111100'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000000000'>, '00000000000000000000000000000001'>, $p0, $l4_1, $l4_2, $l4_3, $l4_4, $l4_5, $l4_6, $l4_7, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $l4_13, $l4_1, '00000000000000000000000000000001', $l4_3, $l4_4, $l4_5, $v0_4<$S, $p0, $l4_1, $l4_2, $l4_3, $l4_4, $l4_5, $l4_6, $l4_7, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $l4_13>, Wasm.I32GtU<Wasm.I32Add<'00000000000000000000000000000000', $l4_3>, '00000000000000000000000000010111'>, $l4_8, $l4_9, $l4_10, $l4_11, $l4_12, $l4_13>>>

type $func_0_impl<$S extends $State, $p0 extends WasmValue> =
  [$Store32<$Store8<$Store8<$S, Wasm.I32Add<'00000000000000000000000000110100', '00000000000000000010000000000000'>, '00000000000000000000000000100000'>, Wasm.I32Add<'00000000000000000000000001001000', '00000000000000000010000000000000'>, '00000000000000000000000001111100'>, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000000000'>, '00000000000000000000000000000001'>, '00000000000000000010000000110100']

type $func_1_impl<$S extends $State> =
  [$S, $LoadI32<$S, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000101100'>>]

type $entry_impl<$S extends $State> =
  [$S, $LoadI32<$S, Wasm.I32Add<'00000000000000000000000000000000', '00000000000000000010000000110000'>>]

export type entry<Args extends []> =
  Convert.WasmValue.ToTSNumber<
    $GetValue<$entry_impl<
      $InitialState
    >>,
    'i32'
  >
