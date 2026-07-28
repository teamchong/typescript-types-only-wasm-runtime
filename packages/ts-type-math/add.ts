import { ReverseString8Segments } from "./binary";
import { Ensure } from "./ensure";
import { Add } from "./hotscript-fork/numbers/impl/addition";
import { WasmValue } from "./wasm";
import type { Satisfies } from './utils'

type Counter = 1[];

type DigitToCounter<T extends string> =
  T extends '0'
  ? []
  : [1]

type Calculation = {
  digit: string,
  carry: Counter,
}

// TODO(perf) look into using a regular string here instead of DigitToCounter

/** this creates a Calculation for the addition */
type Calculate<T extends Counter> =
  T['length'] extends 0 ? { digit: '0', carry: [] } :
  T['length'] extends 1 ? { digit: '1', carry: [] } :
  T['length'] extends 2 ? { digit: '0', carry: [1] } :
  T['length'] extends 3 ? { digit: '1', carry: [1] } :
  never

  // QUESTION: is this faster?
  // vvvvvvvvvvvvvvvvvvvvvvvvv
  // T extends [1, 1, ...infer Remainder]
  // ? {
  //   digit: `${Remainder['length']}`
  //   carry: [1]
  // }
  // : {
  //   digit: `${T['length']}`
  //   carry: []
  // }


/** This function's purpose in life is to avoid needing to calculate C twice */
type AppendCalculationFixedReversed<
  A_Remaining extends string,
  B_Remaining extends string,
  C extends Calculation
> = `${
  C['digit']
}${
  StringAddFixedReversed<
    A_Remaining,
    B_Remaining,
    C['carry']
  >
}`

export type StringAddFixedReversed<
  A extends string,
  B extends string,
  carry extends Counter,
> =
  A extends `${infer A_Digit}${infer A_Remaining}`
  
  ? // A has a digit
    B extends `${infer B_Digit}${infer B_Remaining}`
    ? // A and B both have a digit
      AppendCalculationFixedReversed<
        A_Remaining,
        B_Remaining,
        Calculate<[
          ...DigitToCounter<A_Digit>,
          ...DigitToCounter<B_Digit>,
          ...carry,
        ]>
      >

    : // A has a digit, but B does not
      ''

  : // out of digits.  fuck the carry.
    ''


export type AddBinaryFixed<
  A extends string,
  B extends string,
> = Satisfies<string,
  // we reverse the strings so we can add them from right to left
  // there's no simply way in TypeScript to pick a character off the end of a string
  // this is a huge performance bottleneck (in terms of recursions)
  ReverseString8Segments<
    StringAddFixedReversed<
      ReverseString8Segments<A>,
      ReverseString8Segments<B>,
      []
    >
  >
>

/** This function's purpose in life is to avoid needing to calculate C twice */
type AppendCalculationArbitraryReversed<
  A_Remaining extends string,
  B_Remaining extends string,
  C extends Calculation
> = `${
  C['digit']
}${
  StringAddArbitraryReversed<
    A_Remaining,
    B_Remaining,
    C['carry']
  >
}`

export type StringAddArbitraryReversed<
  A extends string,
  B extends string,
  carry extends Counter,
> =
  A extends `${infer A_Digit}${infer A_Remaining}`
  
  ? // A has a digit
    B extends `${infer B_Digit}${infer B_Remaining}`
    ? // A and B both have a digit
      AppendCalculationArbitraryReversed<
        A_Remaining,
        B_Remaining,
        Calculate<[
          ...DigitToCounter<A_Digit>,
          ...DigitToCounter<B_Digit>,
          ...carry,
        ]>
      >

    : // A has a digit, but B does not
      AppendCalculationArbitraryReversed<
        A_Remaining,
        '', // since we know B is out of digits, we can just pass an empty string
        Calculate<[
          ...DigitToCounter<A_Digit>,
          ...carry
        ]>
      >

    : // A does not have a digit
      B extends `${infer B_Digit}${infer B_Remaining}`

      ? // A does not have a digit, but B does
        AppendCalculationArbitraryReversed<
          '', // since we know A is out of digits, we can just pass an empty string
          B_Remaining,
          Calculate<[
            ...DigitToCounter<B_Digit>,
            ...carry
          ]>
        >


      : // A and B do not have digits left.  just need to resolve the carry
      carry extends []
      ? // there was no a carry, base case of recursion
        ''
      : // there was a carry, base case of recursion
        '1'


/** One nibble of a ripple-carry add: `${A}${B}${carry_in}` -> [sum, carry_out]. */
type AddNibble = {
  '000000000': ['0000', '0'],
  '000000001': ['0001', '0'],
  '000000010': ['0001', '0'],
  '000000011': ['0010', '0'],
  '000000100': ['0010', '0'],
  '000000101': ['0011', '0'],
  '000000110': ['0011', '0'],
  '000000111': ['0100', '0'],
  '000001000': ['0100', '0'],
  '000001001': ['0101', '0'],
  '000001010': ['0101', '0'],
  '000001011': ['0110', '0'],
  '000001100': ['0110', '0'],
  '000001101': ['0111', '0'],
  '000001110': ['0111', '0'],
  '000001111': ['1000', '0'],
  '000010000': ['1000', '0'],
  '000010001': ['1001', '0'],
  '000010010': ['1001', '0'],
  '000010011': ['1010', '0'],
  '000010100': ['1010', '0'],
  '000010101': ['1011', '0'],
  '000010110': ['1011', '0'],
  '000010111': ['1100', '0'],
  '000011000': ['1100', '0'],
  '000011001': ['1101', '0'],
  '000011010': ['1101', '0'],
  '000011011': ['1110', '0'],
  '000011100': ['1110', '0'],
  '000011101': ['1111', '0'],
  '000011110': ['1111', '0'],
  '000011111': ['0000', '1'],
  '000100000': ['0001', '0'],
  '000100001': ['0010', '0'],
  '000100010': ['0010', '0'],
  '000100011': ['0011', '0'],
  '000100100': ['0011', '0'],
  '000100101': ['0100', '0'],
  '000100110': ['0100', '0'],
  '000100111': ['0101', '0'],
  '000101000': ['0101', '0'],
  '000101001': ['0110', '0'],
  '000101010': ['0110', '0'],
  '000101011': ['0111', '0'],
  '000101100': ['0111', '0'],
  '000101101': ['1000', '0'],
  '000101110': ['1000', '0'],
  '000101111': ['1001', '0'],
  '000110000': ['1001', '0'],
  '000110001': ['1010', '0'],
  '000110010': ['1010', '0'],
  '000110011': ['1011', '0'],
  '000110100': ['1011', '0'],
  '000110101': ['1100', '0'],
  '000110110': ['1100', '0'],
  '000110111': ['1101', '0'],
  '000111000': ['1101', '0'],
  '000111001': ['1110', '0'],
  '000111010': ['1110', '0'],
  '000111011': ['1111', '0'],
  '000111100': ['1111', '0'],
  '000111101': ['0000', '1'],
  '000111110': ['0000', '1'],
  '000111111': ['0001', '1'],
  '001000000': ['0010', '0'],
  '001000001': ['0011', '0'],
  '001000010': ['0011', '0'],
  '001000011': ['0100', '0'],
  '001000100': ['0100', '0'],
  '001000101': ['0101', '0'],
  '001000110': ['0101', '0'],
  '001000111': ['0110', '0'],
  '001001000': ['0110', '0'],
  '001001001': ['0111', '0'],
  '001001010': ['0111', '0'],
  '001001011': ['1000', '0'],
  '001001100': ['1000', '0'],
  '001001101': ['1001', '0'],
  '001001110': ['1001', '0'],
  '001001111': ['1010', '0'],
  '001010000': ['1010', '0'],
  '001010001': ['1011', '0'],
  '001010010': ['1011', '0'],
  '001010011': ['1100', '0'],
  '001010100': ['1100', '0'],
  '001010101': ['1101', '0'],
  '001010110': ['1101', '0'],
  '001010111': ['1110', '0'],
  '001011000': ['1110', '0'],
  '001011001': ['1111', '0'],
  '001011010': ['1111', '0'],
  '001011011': ['0000', '1'],
  '001011100': ['0000', '1'],
  '001011101': ['0001', '1'],
  '001011110': ['0001', '1'],
  '001011111': ['0010', '1'],
  '001100000': ['0011', '0'],
  '001100001': ['0100', '0'],
  '001100010': ['0100', '0'],
  '001100011': ['0101', '0'],
  '001100100': ['0101', '0'],
  '001100101': ['0110', '0'],
  '001100110': ['0110', '0'],
  '001100111': ['0111', '0'],
  '001101000': ['0111', '0'],
  '001101001': ['1000', '0'],
  '001101010': ['1000', '0'],
  '001101011': ['1001', '0'],
  '001101100': ['1001', '0'],
  '001101101': ['1010', '0'],
  '001101110': ['1010', '0'],
  '001101111': ['1011', '0'],
  '001110000': ['1011', '0'],
  '001110001': ['1100', '0'],
  '001110010': ['1100', '0'],
  '001110011': ['1101', '0'],
  '001110100': ['1101', '0'],
  '001110101': ['1110', '0'],
  '001110110': ['1110', '0'],
  '001110111': ['1111', '0'],
  '001111000': ['1111', '0'],
  '001111001': ['0000', '1'],
  '001111010': ['0000', '1'],
  '001111011': ['0001', '1'],
  '001111100': ['0001', '1'],
  '001111101': ['0010', '1'],
  '001111110': ['0010', '1'],
  '001111111': ['0011', '1'],
  '010000000': ['0100', '0'],
  '010000001': ['0101', '0'],
  '010000010': ['0101', '0'],
  '010000011': ['0110', '0'],
  '010000100': ['0110', '0'],
  '010000101': ['0111', '0'],
  '010000110': ['0111', '0'],
  '010000111': ['1000', '0'],
  '010001000': ['1000', '0'],
  '010001001': ['1001', '0'],
  '010001010': ['1001', '0'],
  '010001011': ['1010', '0'],
  '010001100': ['1010', '0'],
  '010001101': ['1011', '0'],
  '010001110': ['1011', '0'],
  '010001111': ['1100', '0'],
  '010010000': ['1100', '0'],
  '010010001': ['1101', '0'],
  '010010010': ['1101', '0'],
  '010010011': ['1110', '0'],
  '010010100': ['1110', '0'],
  '010010101': ['1111', '0'],
  '010010110': ['1111', '0'],
  '010010111': ['0000', '1'],
  '010011000': ['0000', '1'],
  '010011001': ['0001', '1'],
  '010011010': ['0001', '1'],
  '010011011': ['0010', '1'],
  '010011100': ['0010', '1'],
  '010011101': ['0011', '1'],
  '010011110': ['0011', '1'],
  '010011111': ['0100', '1'],
  '010100000': ['0101', '0'],
  '010100001': ['0110', '0'],
  '010100010': ['0110', '0'],
  '010100011': ['0111', '0'],
  '010100100': ['0111', '0'],
  '010100101': ['1000', '0'],
  '010100110': ['1000', '0'],
  '010100111': ['1001', '0'],
  '010101000': ['1001', '0'],
  '010101001': ['1010', '0'],
  '010101010': ['1010', '0'],
  '010101011': ['1011', '0'],
  '010101100': ['1011', '0'],
  '010101101': ['1100', '0'],
  '010101110': ['1100', '0'],
  '010101111': ['1101', '0'],
  '010110000': ['1101', '0'],
  '010110001': ['1110', '0'],
  '010110010': ['1110', '0'],
  '010110011': ['1111', '0'],
  '010110100': ['1111', '0'],
  '010110101': ['0000', '1'],
  '010110110': ['0000', '1'],
  '010110111': ['0001', '1'],
  '010111000': ['0001', '1'],
  '010111001': ['0010', '1'],
  '010111010': ['0010', '1'],
  '010111011': ['0011', '1'],
  '010111100': ['0011', '1'],
  '010111101': ['0100', '1'],
  '010111110': ['0100', '1'],
  '010111111': ['0101', '1'],
  '011000000': ['0110', '0'],
  '011000001': ['0111', '0'],
  '011000010': ['0111', '0'],
  '011000011': ['1000', '0'],
  '011000100': ['1000', '0'],
  '011000101': ['1001', '0'],
  '011000110': ['1001', '0'],
  '011000111': ['1010', '0'],
  '011001000': ['1010', '0'],
  '011001001': ['1011', '0'],
  '011001010': ['1011', '0'],
  '011001011': ['1100', '0'],
  '011001100': ['1100', '0'],
  '011001101': ['1101', '0'],
  '011001110': ['1101', '0'],
  '011001111': ['1110', '0'],
  '011010000': ['1110', '0'],
  '011010001': ['1111', '0'],
  '011010010': ['1111', '0'],
  '011010011': ['0000', '1'],
  '011010100': ['0000', '1'],
  '011010101': ['0001', '1'],
  '011010110': ['0001', '1'],
  '011010111': ['0010', '1'],
  '011011000': ['0010', '1'],
  '011011001': ['0011', '1'],
  '011011010': ['0011', '1'],
  '011011011': ['0100', '1'],
  '011011100': ['0100', '1'],
  '011011101': ['0101', '1'],
  '011011110': ['0101', '1'],
  '011011111': ['0110', '1'],
  '011100000': ['0111', '0'],
  '011100001': ['1000', '0'],
  '011100010': ['1000', '0'],
  '011100011': ['1001', '0'],
  '011100100': ['1001', '0'],
  '011100101': ['1010', '0'],
  '011100110': ['1010', '0'],
  '011100111': ['1011', '0'],
  '011101000': ['1011', '0'],
  '011101001': ['1100', '0'],
  '011101010': ['1100', '0'],
  '011101011': ['1101', '0'],
  '011101100': ['1101', '0'],
  '011101101': ['1110', '0'],
  '011101110': ['1110', '0'],
  '011101111': ['1111', '0'],
  '011110000': ['1111', '0'],
  '011110001': ['0000', '1'],
  '011110010': ['0000', '1'],
  '011110011': ['0001', '1'],
  '011110100': ['0001', '1'],
  '011110101': ['0010', '1'],
  '011110110': ['0010', '1'],
  '011110111': ['0011', '1'],
  '011111000': ['0011', '1'],
  '011111001': ['0100', '1'],
  '011111010': ['0100', '1'],
  '011111011': ['0101', '1'],
  '011111100': ['0101', '1'],
  '011111101': ['0110', '1'],
  '011111110': ['0110', '1'],
  '011111111': ['0111', '1'],
  '100000000': ['1000', '0'],
  '100000001': ['1001', '0'],
  '100000010': ['1001', '0'],
  '100000011': ['1010', '0'],
  '100000100': ['1010', '0'],
  '100000101': ['1011', '0'],
  '100000110': ['1011', '0'],
  '100000111': ['1100', '0'],
  '100001000': ['1100', '0'],
  '100001001': ['1101', '0'],
  '100001010': ['1101', '0'],
  '100001011': ['1110', '0'],
  '100001100': ['1110', '0'],
  '100001101': ['1111', '0'],
  '100001110': ['1111', '0'],
  '100001111': ['0000', '1'],
  '100010000': ['0000', '1'],
  '100010001': ['0001', '1'],
  '100010010': ['0001', '1'],
  '100010011': ['0010', '1'],
  '100010100': ['0010', '1'],
  '100010101': ['0011', '1'],
  '100010110': ['0011', '1'],
  '100010111': ['0100', '1'],
  '100011000': ['0100', '1'],
  '100011001': ['0101', '1'],
  '100011010': ['0101', '1'],
  '100011011': ['0110', '1'],
  '100011100': ['0110', '1'],
  '100011101': ['0111', '1'],
  '100011110': ['0111', '1'],
  '100011111': ['1000', '1'],
  '100100000': ['1001', '0'],
  '100100001': ['1010', '0'],
  '100100010': ['1010', '0'],
  '100100011': ['1011', '0'],
  '100100100': ['1011', '0'],
  '100100101': ['1100', '0'],
  '100100110': ['1100', '0'],
  '100100111': ['1101', '0'],
  '100101000': ['1101', '0'],
  '100101001': ['1110', '0'],
  '100101010': ['1110', '0'],
  '100101011': ['1111', '0'],
  '100101100': ['1111', '0'],
  '100101101': ['0000', '1'],
  '100101110': ['0000', '1'],
  '100101111': ['0001', '1'],
  '100110000': ['0001', '1'],
  '100110001': ['0010', '1'],
  '100110010': ['0010', '1'],
  '100110011': ['0011', '1'],
  '100110100': ['0011', '1'],
  '100110101': ['0100', '1'],
  '100110110': ['0100', '1'],
  '100110111': ['0101', '1'],
  '100111000': ['0101', '1'],
  '100111001': ['0110', '1'],
  '100111010': ['0110', '1'],
  '100111011': ['0111', '1'],
  '100111100': ['0111', '1'],
  '100111101': ['1000', '1'],
  '100111110': ['1000', '1'],
  '100111111': ['1001', '1'],
  '101000000': ['1010', '0'],
  '101000001': ['1011', '0'],
  '101000010': ['1011', '0'],
  '101000011': ['1100', '0'],
  '101000100': ['1100', '0'],
  '101000101': ['1101', '0'],
  '101000110': ['1101', '0'],
  '101000111': ['1110', '0'],
  '101001000': ['1110', '0'],
  '101001001': ['1111', '0'],
  '101001010': ['1111', '0'],
  '101001011': ['0000', '1'],
  '101001100': ['0000', '1'],
  '101001101': ['0001', '1'],
  '101001110': ['0001', '1'],
  '101001111': ['0010', '1'],
  '101010000': ['0010', '1'],
  '101010001': ['0011', '1'],
  '101010010': ['0011', '1'],
  '101010011': ['0100', '1'],
  '101010100': ['0100', '1'],
  '101010101': ['0101', '1'],
  '101010110': ['0101', '1'],
  '101010111': ['0110', '1'],
  '101011000': ['0110', '1'],
  '101011001': ['0111', '1'],
  '101011010': ['0111', '1'],
  '101011011': ['1000', '1'],
  '101011100': ['1000', '1'],
  '101011101': ['1001', '1'],
  '101011110': ['1001', '1'],
  '101011111': ['1010', '1'],
  '101100000': ['1011', '0'],
  '101100001': ['1100', '0'],
  '101100010': ['1100', '0'],
  '101100011': ['1101', '0'],
  '101100100': ['1101', '0'],
  '101100101': ['1110', '0'],
  '101100110': ['1110', '0'],
  '101100111': ['1111', '0'],
  '101101000': ['1111', '0'],
  '101101001': ['0000', '1'],
  '101101010': ['0000', '1'],
  '101101011': ['0001', '1'],
  '101101100': ['0001', '1'],
  '101101101': ['0010', '1'],
  '101101110': ['0010', '1'],
  '101101111': ['0011', '1'],
  '101110000': ['0011', '1'],
  '101110001': ['0100', '1'],
  '101110010': ['0100', '1'],
  '101110011': ['0101', '1'],
  '101110100': ['0101', '1'],
  '101110101': ['0110', '1'],
  '101110110': ['0110', '1'],
  '101110111': ['0111', '1'],
  '101111000': ['0111', '1'],
  '101111001': ['1000', '1'],
  '101111010': ['1000', '1'],
  '101111011': ['1001', '1'],
  '101111100': ['1001', '1'],
  '101111101': ['1010', '1'],
  '101111110': ['1010', '1'],
  '101111111': ['1011', '1'],
  '110000000': ['1100', '0'],
  '110000001': ['1101', '0'],
  '110000010': ['1101', '0'],
  '110000011': ['1110', '0'],
  '110000100': ['1110', '0'],
  '110000101': ['1111', '0'],
  '110000110': ['1111', '0'],
  '110000111': ['0000', '1'],
  '110001000': ['0000', '1'],
  '110001001': ['0001', '1'],
  '110001010': ['0001', '1'],
  '110001011': ['0010', '1'],
  '110001100': ['0010', '1'],
  '110001101': ['0011', '1'],
  '110001110': ['0011', '1'],
  '110001111': ['0100', '1'],
  '110010000': ['0100', '1'],
  '110010001': ['0101', '1'],
  '110010010': ['0101', '1'],
  '110010011': ['0110', '1'],
  '110010100': ['0110', '1'],
  '110010101': ['0111', '1'],
  '110010110': ['0111', '1'],
  '110010111': ['1000', '1'],
  '110011000': ['1000', '1'],
  '110011001': ['1001', '1'],
  '110011010': ['1001', '1'],
  '110011011': ['1010', '1'],
  '110011100': ['1010', '1'],
  '110011101': ['1011', '1'],
  '110011110': ['1011', '1'],
  '110011111': ['1100', '1'],
  '110100000': ['1101', '0'],
  '110100001': ['1110', '0'],
  '110100010': ['1110', '0'],
  '110100011': ['1111', '0'],
  '110100100': ['1111', '0'],
  '110100101': ['0000', '1'],
  '110100110': ['0000', '1'],
  '110100111': ['0001', '1'],
  '110101000': ['0001', '1'],
  '110101001': ['0010', '1'],
  '110101010': ['0010', '1'],
  '110101011': ['0011', '1'],
  '110101100': ['0011', '1'],
  '110101101': ['0100', '1'],
  '110101110': ['0100', '1'],
  '110101111': ['0101', '1'],
  '110110000': ['0101', '1'],
  '110110001': ['0110', '1'],
  '110110010': ['0110', '1'],
  '110110011': ['0111', '1'],
  '110110100': ['0111', '1'],
  '110110101': ['1000', '1'],
  '110110110': ['1000', '1'],
  '110110111': ['1001', '1'],
  '110111000': ['1001', '1'],
  '110111001': ['1010', '1'],
  '110111010': ['1010', '1'],
  '110111011': ['1011', '1'],
  '110111100': ['1011', '1'],
  '110111101': ['1100', '1'],
  '110111110': ['1100', '1'],
  '110111111': ['1101', '1'],
  '111000000': ['1110', '0'],
  '111000001': ['1111', '0'],
  '111000010': ['1111', '0'],
  '111000011': ['0000', '1'],
  '111000100': ['0000', '1'],
  '111000101': ['0001', '1'],
  '111000110': ['0001', '1'],
  '111000111': ['0010', '1'],
  '111001000': ['0010', '1'],
  '111001001': ['0011', '1'],
  '111001010': ['0011', '1'],
  '111001011': ['0100', '1'],
  '111001100': ['0100', '1'],
  '111001101': ['0101', '1'],
  '111001110': ['0101', '1'],
  '111001111': ['0110', '1'],
  '111010000': ['0110', '1'],
  '111010001': ['0111', '1'],
  '111010010': ['0111', '1'],
  '111010011': ['1000', '1'],
  '111010100': ['1000', '1'],
  '111010101': ['1001', '1'],
  '111010110': ['1001', '1'],
  '111010111': ['1010', '1'],
  '111011000': ['1010', '1'],
  '111011001': ['1011', '1'],
  '111011010': ['1011', '1'],
  '111011011': ['1100', '1'],
  '111011100': ['1100', '1'],
  '111011101': ['1101', '1'],
  '111011110': ['1101', '1'],
  '111011111': ['1110', '1'],
  '111100000': ['1111', '0'],
  '111100001': ['0000', '1'],
  '111100010': ['0000', '1'],
  '111100011': ['0001', '1'],
  '111100100': ['0001', '1'],
  '111100101': ['0010', '1'],
  '111100110': ['0010', '1'],
  '111100111': ['0011', '1'],
  '111101000': ['0011', '1'],
  '111101001': ['0100', '1'],
  '111101010': ['0100', '1'],
  '111101011': ['0101', '1'],
  '111101100': ['0101', '1'],
  '111101101': ['0110', '1'],
  '111101110': ['0110', '1'],
  '111101111': ['0111', '1'],
  '111110000': ['0111', '1'],
  '111110001': ['1000', '1'],
  '111110010': ['1000', '1'],
  '111110011': ['1001', '1'],
  '111110100': ['1001', '1'],
  '111110101': ['1010', '1'],
  '111110110': ['1010', '1'],
  '111110111': ['1011', '1'],
  '111111000': ['1011', '1'],
  '111111001': ['1100', '1'],
  '111111010': ['1100', '1'],
  '111111011': ['1101', '1'],
  '111111100': ['1101', '1'],
  '111111101': ['1110', '1'],
  '111111110': ['1110', '1'],
  '111111111': ['1111', '1'],
}

/**
 * A 32-bit add with no recursion: 1130 instantiations per add before, 287 now.
 * The old path reversed both operands 8 chars at a time and then recursed once
 * per bit.
 *
 * Consecutive `${infer}` placeholders each capture exactly one character, so
 * the 32 chars have to come out one at a time - a template pattern cannot be
 * asked for 4-char groups. They only need to be *recombined* in groups though,
 * so the carry chain is 8 table lookups rather than 32 recursive steps.
 * Dropping the 33rd bit is what i32.add does anyway, so the wrap is free.
 *
 * Each step matches the key against `keyof AddNibble` before indexing. Indexing
 * with a non-literal key would instead hand back a union of all 512 entries,
 * and eight of those multiply out to a union too complex to represent - which
 * is exactly what the checker builds when it validates this body generically.
 */
export type Add32Nibble<A extends string, B extends string> =
  A extends `${infer a0 extends string}${infer a1 extends string}${infer a2 extends string}${infer a3 extends string}${infer a4 extends string}${infer a5 extends string}${infer a6 extends string}${infer a7 extends string}${infer a8 extends string}${infer a9 extends string}${infer a10 extends string}${infer a11 extends string}${infer a12 extends string}${infer a13 extends string}${infer a14 extends string}${infer a15 extends string}${infer a16 extends string}${infer a17 extends string}${infer a18 extends string}${infer a19 extends string}${infer a20 extends string}${infer a21 extends string}${infer a22 extends string}${infer a23 extends string}${infer a24 extends string}${infer a25 extends string}${infer a26 extends string}${infer a27 extends string}${infer a28 extends string}${infer a29 extends string}${infer a30 extends string}${infer a31 extends string}` ? B extends `${infer b0 extends string}${infer b1 extends string}${infer b2 extends string}${infer b3 extends string}${infer b4 extends string}${infer b5 extends string}${infer b6 extends string}${infer b7 extends string}${infer b8 extends string}${infer b9 extends string}${infer b10 extends string}${infer b11 extends string}${infer b12 extends string}${infer b13 extends string}${infer b14 extends string}${infer b15 extends string}${infer b16 extends string}${infer b17 extends string}${infer b18 extends string}${infer b19 extends string}${infer b20 extends string}${infer b21 extends string}${infer b22 extends string}${infer b23 extends string}${infer b24 extends string}${infer b25 extends string}${infer b26 extends string}${infer b27 extends string}${infer b28 extends string}${infer b29 extends string}${infer b30 extends string}${infer b31 extends string}` ?
  `${a28}${a29}${a30}${a31}${b28}${b29}${b30}${b31}${'0'}` extends infer k7 extends keyof AddNibble
  ? AddNibble[k7] extends [infer s7 extends string, infer c7 extends string]
  ?   `${a24}${a25}${a26}${a27}${b24}${b25}${b26}${b27}${c7}` extends infer k6 extends keyof AddNibble
  ? AddNibble[k6] extends [infer s6 extends string, infer c6 extends string]
  ?   `${a20}${a21}${a22}${a23}${b20}${b21}${b22}${b23}${c6}` extends infer k5 extends keyof AddNibble
  ? AddNibble[k5] extends [infer s5 extends string, infer c5 extends string]
  ?   `${a16}${a17}${a18}${a19}${b16}${b17}${b18}${b19}${c5}` extends infer k4 extends keyof AddNibble
  ? AddNibble[k4] extends [infer s4 extends string, infer c4 extends string]
  ?   `${a12}${a13}${a14}${a15}${b12}${b13}${b14}${b15}${c4}` extends infer k3 extends keyof AddNibble
  ? AddNibble[k3] extends [infer s3 extends string, infer c3 extends string]
  ?   `${a8}${a9}${a10}${a11}${b8}${b9}${b10}${b11}${c3}` extends infer k2 extends keyof AddNibble
  ? AddNibble[k2] extends [infer s2 extends string, infer c2 extends string]
  ?   `${a4}${a5}${a6}${a7}${b4}${b5}${b6}${b7}${c2}` extends infer k1 extends keyof AddNibble
  ? AddNibble[k1] extends [infer s1 extends string, infer c1 extends string]
  ?   `${a0}${a1}${a2}${a3}${b0}${b1}${b2}${b3}${c1}` extends infer k0 extends keyof AddNibble
  ? AddNibble[k0] extends [infer s0 extends string, infer c0 extends string]
  ? `${s0}${s1}${s2}${s3}${s4}${s5}${s6}${s7}`
 : never : never : never : never : never : never : never : never : never : never : never : never : never : never : never : never : never : never

export type I32AddBinary<
  a extends WasmValue,
  b extends WasmValue
> = Satisfies<WasmValue,
  Add32Nibble<a, b>
>

export type I64AddBinary<
  a extends WasmValue,
  b extends WasmValue
> = Satisfies<WasmValue,
  AddBinaryFixed<a, b>
>

export type I32AddDecimal<
  a extends number,
  b extends number,
> = Satisfies<number,
  Add<a, b>
>


/*

The following is a disappointing failure.

The goal is to do addition from left to right (i.e. MSB to LSB).

To accomplish this, you consider a moving window where you can look at the next digit of A and B _as well as_ the next digit of each _after that_.

The problem is, you need an effectively infinite lookup to make sure you don't have to carry.

Consider the following:
'011',
'001'

for the first window we see `01` in A and `00` in B.  This is a simple addition, no carry.

EXCEPT IT ISN"T because in the next frame you have a carry but you just can't see it yet.

That means you effectively have to implement an infinite forward lookup.  I might.  I fucking just might.  But in the end it'll probably be easier to just.... I can't believe I'm even saying this... to just store everything in reverse order all the time.

*/

// type AdditionMatrixLookup = {
// // AABB
// // 0101
//   '0000': '0', // one 1
//   '0001': '0', // one 1
//   '0010': '1', // one 1
//   '0100': '0', // one 1
//   '1000': '1', // one 1
//   '0011': '1', // two 1s
//   '0110': '1', // two 1s
//   '1100': '1', // two 1s
//   '1001': '1', // two 1s
//   '0101': '1', // two 1s
//   '1010': '0', // two 1s
//   '1110': '0', // three 1s
//   '1101': '0', // three 1s
//   '1011': '0', // three 1s
//   '0111': '0', // three 1s
//   '1111': '1', // four 1s
// }

// type AdditionLookup = {
//   // AB
//     '00': '0',
//     '10': '1',
//     '01': '1',
//     '11': '0',
//   }

// export type AddBinaryDoNotLookDownVersion<
//   A extends string,
//   B extends string,
//   Acc extends string = '',
// > =
//   A extends `${infer A0 extends string}${infer A1 extends string}${infer ARest}`
//   ? B extends `${infer B0 extends string}${infer B1 extends string}${infer BRest}`
//     ? `${A0}${A1}${B0}${B1}` extends infer Lookup extends keyof AdditionMatrixLookup
//        ? AddBinaryDoNotLookDownVersion<
//           `${A1}${ARest}`,
//           `${B1}${BRest}`,
//           `${Acc}${AdditionMatrixLookup[Lookup]}`
//          >
//        : never // a not-binary number was passed in
//     : never // unequal lengths were passed in
//   : // we've reached the last digits
//     `${Acc}${
//       `${A}${B}` extends infer Lookup extends keyof AdditionLookup
//         ? AdditionLookup[Lookup]
//         : never // a not-binary number was passed in
//     }`

// type t =  AddBinaryDoNotLookDownVersion<
//   '011',
//   '001'
// // 0x
// //  ^- here's where it fucks up because it can't see the carry coming from far ahead
// > // =>