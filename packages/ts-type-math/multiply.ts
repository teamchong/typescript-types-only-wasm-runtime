import { StringAddArbitraryReversed } from "./add";
import { IsNegativeBinary, ReverseString8Segments, ReverseStringTheWorstWayPossible, TwosComplementFlip } from "./binary";
import { Ensure } from "./ensure";
import { Wasm, WasmValue } from "./wasm";
import type { Satisfies } from './utils'

type a = "00000000000000000000000001100100"
type b = "00000000000000000000000000001010"

export type I32MultiplyBinary<
  a extends WasmValue,
  b extends WasmValue
> = Satisfies<WasmValue,
  a extends Wasm.I32False ? Wasm.I32False :
  b extends Wasm.I32False ? Wasm.I32False :
  a extends Wasm.I32True ? b :
  b extends Wasm.I32True ? a :
  Ensure.I32<_MultiplyI32<a, b>>
>

/// The loop runs once per digit of the multiplier up to its highest one bit, so
/// the multiplier's significant width, not the product, decides whether it
/// finishes. Multiplication commutes, so the narrower operand can always be the
/// one driving it. Measured: 255 * 393480 with 393480 driving is
/// "excessively deep" and comes back an error type; the same product with 255
/// driving compiles clean and correct.
type _Significant<s extends string> = s extends `0${infer rest}` ? _Significant<rest> : s

/// True when `a` is no wider than `b`. Consuming both a character at a time
/// compares widths without counting either.
type _NoWider<a extends string, b extends string> =
  a extends `${string}${infer aRest}`
  ? b extends `${string}${infer bRest}`
    ? _NoWider<aRest, bRest>
    : false
  : true

type _MultiplyNarrowest<a extends string, b extends string> =
  _NoWider<_Significant<b>, _Significant<a>> extends true
  ? _MultiplyBinary<ReverseString8Segments<a>, ReverseString8Segments<b>, '', ''>
  : _MultiplyBinary<ReverseString8Segments<b>, ReverseString8Segments<a>, '', ''>

/// Swapping is not enough when both operands are wide: 65536 * 393480 has no
/// narrow side and still comes back an error type. A 16-bit multiplier always
/// finishes, so split the multiplier instead of hoping one side is small.
///
///   a * b = a*bLo + ((a*bHi) << 16)
///
/// Only the low 32 bits survive, so a*bHi needs no more than its low 16 bits
/// and the shifted-out half costs nothing.
type _Halves<s extends string> =
  s extends `${infer c0}${infer c1}${infer c2}${infer c3}${infer c4}${infer c5}${infer c6}${infer c7}${infer c8}${infer c9}${infer c10}${infer c11}${infer c12}${infer c13}${infer c14}${infer c15}${infer lo}`
  ? [`0000000000000000${c0}${c1}${c2}${c3}${c4}${c5}${c6}${c7}${c8}${c9}${c10}${c11}${c12}${c13}${c14}${c15}`, `0000000000000000${lo}`]
  : never

/// Splitting the multiplier costs two multiplies, an add and a shift even when
/// one half is zero, and most multipliers doom runs are small. Measured per
/// I32Mul, on 32 distinct operand pairs:
///
///     b = 3        2127 instantiations -> 1153
///     b = 0x00ff   3796                -> 2822
///     b = 0xffff   7600                -> 6626
///     b = 0x10000  1937                -> 1647
///
/// A one bit in the multiplier costs ~335, so skipping a zero half saves about
/// what three of them cost.
type _MultiplyI32<a extends string, b extends string> =
  _Halves<b> extends [infer hi extends string, infer lo extends string]
  ? hi extends Wasm.I32False
    ? _MultiplyNarrowest<a, lo>
    : lo extends Wasm.I32False
      ? Wasm.I32Shl<Ensure.I32<_MultiplyNarrowest<a, hi>>, '00000000000000000000000000010000'>
      : Wasm.I32Add<
          Ensure.I32<_MultiplyNarrowest<a, lo>>,
          Wasm.I32Shl<Ensure.I32<_MultiplyNarrowest<a, hi>>, '00000000000000000000000000010000'>
        >
  : never

type _Magnitude64<a extends string, b extends string> =
  Ensure.I64<_MultiplyNarrowest<a, b>>

/// A zero bit costs the partial-product loop nothing, but a one bit costs an add
/// over the whole accumulator - and a sign-extended negative i32 carries 32
/// leading one bits, so doom's FixedMul paid 32 extra adds over 128 characters
/// and came back `never`. Two's complement multiplication does not care about
/// sign, so multiplying magnitudes and negating once at the end gives the same
/// low 64 bits with those leading bits back to being zeros.
export type I64MultiplyBinary<
  a extends WasmValue,
  b extends WasmValue
> = Satisfies<WasmValue,
  a extends Wasm.I64False ? Wasm.I64False :
  b extends Wasm.I64False ? Wasm.I64False :
  a extends Wasm.I64True ? b :
  b extends Wasm.I64True ? a :
  IsNegativeBinary<a> extends true
    ? IsNegativeBinary<b> extends true
      ? _Magnitude64<TwosComplementFlip<a>, TwosComplementFlip<b>>
      : TwosComplementFlip<_Magnitude64<TwosComplementFlip<a>, b>>
    : IsNegativeBinary<b> extends true
      ? TwosComplementFlip<_Magnitude64<a, TwosComplementFlip<b>>>
      : _Magnitude64<a, b>
>

/// Once the remaining multiplier digits are all zero every further step is a
/// no-op that still costs a recursion carrying the whole accumulator. The
/// reversed multiplier puts the high bits last, so a small multiplier - a
/// constant, a fixed-point fraction - spends most of the loop there. Stopping
/// at the last one bit gives the same accumulator for less work.
type _MulStep<
  a extends string,
  tail extends string,
  _Place extends string,
  _Acc extends string
> =
  tail extends `${string}1${string}`
  ? _MultiplyBinary<a, tail, _Place, _Acc>
  : ReverseStringTheWorstWayPossible<_Acc>

export type _MultiplyBinary<
  a extends string,
  revB extends string,

  _Place extends string,
  _Acc extends string
> =
  revB extends `${infer digit}${infer tail}`
  ? digit extends "0"
    ? // there's no point in doing any "work", so we can just move on to the next digit
      _MulStep<
        a,
        tail,
        `0${_Place}`,
        _Acc
      >

    : // we have a digit to multiply
      _MulStep<
        a,
        tail,
        `0${_Place}`,

        StringAddArbitraryReversed<
          `${_Place}${a}`,
          _Acc,
          []
        >
      >

  : ReverseStringTheWorstWayPossible<_Acc>
