/** tells the machine to add a string to the current */
type AddInstruction = {
  kind: 'add';
  value: string;
}

type HandleAddInstruction<
  instruction extends AddInstruction,
  state extends ProgramState
> = {
  instructions: state['instructions'];
  result: `${state['result']}${instruction['value']}`;
}

/** tells the machine to uppercase the whole string */
type UppercaseInstruction = {
  kind: 'uppercase';
}

type HandleUppercaseInstruction<
  instruction extends UppercaseInstruction, // unused, but the instruction itself is always passed first to an instruction handler for consistency
  state extends ProgramState
> = {
  instructions: state['instructions'];
  result: Uppercase<state['result']>;
}

type Instruction = AddInstruction | UppercaseInstruction;

type selectInstruction<
  initialState extends ProgramState,
  remainingInstructions extends Instruction[],
  instruction extends Instruction,
  state extends ProgramState = {
    instructions: remainingInstructions;
    result: initialState['result'];
  }
> =
  instruction extends AddInstruction
  ? HandleAddInstruction<instruction, state>

  : instruction extends UppercaseInstruction
  ? HandleUppercaseInstruction<instruction, state>

  : never


type ProgramState = {
  instructions: Instruction[];
  result: string;
}

type executeInstruction<
  state extends ProgramState
> =
  state['instructions'] extends [
    infer instruction extends Instruction,
    ...infer remainingInstructions extends Instruction[]
  ]

  ? executeInstruction<
      selectInstruction<
        state,
        remainingInstructions,
        instruction
      >
    >

  : state['result'];

type Bootstrap = {
  instructions: [
    {
      kind: 'add',
      value: 'hello'
    },
    {
      kind: 'add',
      value: ' world'
    },
    {
      kind: 'uppercase'
    },
    {
      kind: 'add',
      value: '!'
    },
  ];
  result: '';
}

type Execution = executeInstruction<Bootstrap>;
//   ^?