/** tells the machine to add a string to the current */
export type AddInstruction = {
  kind: 'add';
  value: string;
}

export type HandleAddInstruction<
  instruction extends AddInstruction,
  state extends ProgramState
> = {
  count: state['count'];
  instructions: state['instructions'];
  result: `${state['result']}${instruction['value']}`;
}

/** tells the machine to uppercase the whole string */
export type UppercaseInstruction = {
  kind: 'uppercase';
}

export type HandleUppercaseInstruction<
  instruction extends UppercaseInstruction, // unused, but the instruction itself is always passed first to an instruction handler for consistency
  state extends ProgramState
> = {
  count: state['count'];
  instructions: state['instructions'];
  result: Uppercase<state['result']>;
}

export type Instruction = AddInstruction | UppercaseInstruction;

export type selectInstruction<
  initialState extends ProgramState,
  remainingInstructions extends Instruction[],
  instruction extends Instruction,
  state extends ProgramState = {
    count: [...initialState['count'], 1];
    instructions: remainingInstructions;
    result: initialState['result'];
  }
> =
  instruction extends AddInstruction
  ? HandleAddInstruction<instruction, state>

  : instruction extends UppercaseInstruction
  ? HandleUppercaseInstruction<instruction, state>

  : never


export type ProgramState = {
  count: 1[];
  instructions: Instruction[];
  result: string;
}

export type executeInstruction<
  state extends ProgramState,
  stopAt extends number = 1000,
> =
  state['instructions'] extends [
    infer instruction extends Instruction,
    ...infer remainingInstructions extends Instruction[]
  ]

  ? stopAt extends state['count']['length']
    ? state
    : executeInstruction<
        selectInstruction<
          state,
          remainingInstructions,
          instruction
        >,
        stopAt
      >

  : state['result'];


export type Bootstrap = {
  count: [];
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

// with no explicit `stopAt`, the program will run until it's done
export type Execution = executeInstruction<Bootstrap>;
//          ^?

export type Execution0 = executeInstruction<Bootstrap, 0>;
export type Execution0Result = Execution0['result'];
//          ^?

export type Execution1 = executeInstruction<Bootstrap, 1>;
export type Execution1Result = Execution1['result']
//          ^?

export type Execution2 = executeInstruction<Bootstrap, 2>;
export type Execution2Result = Execution2['result']
//          ^?

export type Execution3 = executeInstruction<Bootstrap, 3>;
export type Execution3Result = Execution3['result']
//          ^?

export type Execution4 = executeInstruction<Bootstrap, 4>;
export type Execution4Result = Execution4
//          ^?