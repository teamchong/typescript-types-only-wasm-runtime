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
  Ensure.I32<
    _MultiplyBinary<
      ReverseString8Segments<a>,
      ReverseString8Segments<b>,
      '',
      ''
    >
  >
>

type _Magnitude64<a extends string, b extends string> =
  Ensure.I64<
    _MultiplyBinary<
      ReverseString8Segments<a>,
      ReverseString8Segments<b>,
      '',
      ''
    >
  >

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

export type _MultiplyBinary<
  a extends string,
  revB extends string,

  _Place extends string,
  _Acc extends string
> =
  revB extends `${infer digit}${infer tail}`
  ? digit extends "0"
    ? // there's no point in doing any "work", so we can just move on to the next digit
      _MultiplyBinary<
        a,
        tail,
        `0${_Place}`,
        _Acc
      >

    : // we have a digit to multiply
      _MultiplyBinary<
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
