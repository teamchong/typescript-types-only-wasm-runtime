//! CFG AOT compiler - WASM to TypeScript types, as fuel-bounded basic blocks.
//!
//! Two measured facts drive this design:
//!
//! 1. Memory cannot be `S['memory'] & Record<Addr, V>`. Intersecting two
//!    different literals for one key gives `never`, so the second write to a
//!    word poisons it - and an `i32.store8` is a read-modify-write, so four
//!    byte stores into one word are enough. Memory here is a sparse binary trie
//!    keyed by the address bits: correct, ~2*depth per write, and it prints as
//!    a nested tuple of string literals that the host can paste straight back.
//!
//! 2. One type evaluation can only thread ~100 state transitions before
//!    TS2589. That is independent of the memory representation (intersections,
//!    Omit, mapped rewrites and tries all die between 96 and 240 stores), so a
//!    frame cannot be one evaluation. Every block therefore carries a fuel
//!    tuple; when it runs out the block returns a suspend tuple naming the
//!    block and its live values, and the host re-enters with fresh fuel.
//!
//! Control flow is real: each WASM label becomes a named type, `br`/`br_if`/
//! loop back-edges become tail calls to those types, and `if`/`else` join
//! through a shared continuation. Nothing is "skipped forward N ends".

use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::rc::Rc;
use wasmparser::{BlockType, FuncType, Operator, Parser, Payload, ValType};

/// How many stores a chunk may perform before suspending. Measured ceiling is
/// ~100 state transitions per evaluation; 80 leaves headroom for the reads and
/// arithmetic that share the same depth budget.
pub const DEFAULT_FUEL: usize = 80;

/// Every computed value gets a name. Nesting arithmetic - `I32Add<I32Add<..>,..>`
/// inside `$Store8` inside `$Put` - stacks each operator's ~32 levels of bit
/// recursion into one instantiation chain, and ts-type-math raises TS2589 well
/// before a block finishes. Naming each result turns the block into a flat
/// sequence of conditionals, so depth stays proportional to one operator rather
/// than to the whole expression tree. Measured: this is the difference between
/// a corrupted `any` in the state and a clean frame.
const SSA: bool = true;

fn bits32(value: i32) -> String {
    format!("{:032b}", value as u32)
}

fn zero() -> String {
    bits32(0)
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum LabelKind {
    Block,
    Loop,
}

/// A WASM label, compiled to a named type we can tail-call.
///
/// `br` and falling off the end are different edges: for a `block` both go to
/// the code after `end`, but for a `loop` a `br` goes back to the header while
/// falling off the end leaves the loop. Keeping both means loops terminate.
#[derive(Debug, Clone)]
struct Label {
    kind: LabelKind,
    /// block id a `br` to this label jumps to
    target: usize,
    /// block id reached by falling off this label's `end`
    exit: usize,
    /// values the `br` target takes off the top of the stack
    arity: usize,
    /// values the `end` continuation takes off the top of the stack
    exit_arity: usize,
    /// stack depth below the label's own operands
    stack_floor: usize,
}

/// A block waiting to be compiled: entry point plus the symbolic environment
/// its parameters describe.
#[derive(Debug, Clone)]
struct Pending {
    id: usize,
    pos: usize,
    labels: Vec<Label>,
    /// stack values at entry, as parameter names
    stack: Vec<String>,
}

#[derive(Debug, Clone)]
struct EmittedBlock {
    id: usize,
    /// parameter list after fuel + memory: globals, locals, then stack
    stack_arity: usize,
    body: String,
    /// fuel this block charges on entry: one hop plus its own stores
    cost: usize,
    /// locals read before being written here
    reads: BTreeSet<u32>,
    /// locals written here
    writes: BTreeSet<u32>,
    /// blocks this one can jump to
    successors: Vec<usize>,
    /// locals live on entry, filled in once the whole function is compiled
    live: BTreeSet<u32>,
}

pub struct CfgCompiler {
    /// override for the trie's address-bit count (testing)
    pub bits_override: Option<usize>,
    /// address bits consumed per trie level: 3 means an 8-way trie
    pub digit_bits: usize,
    func_types: Vec<FuncType>,
    func_type_indices: Vec<u32>,
    /// (offset, bytes) of each active data segment
    data: Vec<(u32, Vec<u8>)>,
    globals: Vec<i64>,
    memory_pages: u64,
    /// export name -> function index (into defined functions)
    exports: Vec<(String, u32)>,
    num_imports: u32,
    /// address bits the trie covers
    trie_bits: usize,
    /// specialised helpers emitted on demand: shifts and masks by a constant
    /// are character surgery on the 32-character word, not bit recursion
    helpers: Rc<RefCell<BTreeMap<String, String>>>,
}

impl CfgCompiler {
    pub fn new() -> Self {
        Self {
            bits_override: None,
            // address bits per trie level. 3 is an 8-way trie, five levels deep
            // for a 15-bit address space; TRIE_DIGIT_BITS sweeps it.
            digit_bits: std::env::var("TRIE_DIGIT_BITS")
                .ok()
                .and_then(|value| value.parse().ok())
                .filter(|bits| (1..=6).contains(bits))
                .unwrap_or(3),
            func_types: Vec::new(),
            func_type_indices: Vec::new(),
            data: Vec::new(),
            globals: Vec::new(),
            memory_pages: 1,
            exports: Vec::new(),
            num_imports: 0,
            trie_bits: 14,
            helpers: Rc::new(RefCell::new(BTreeMap::new())),
        }
    }

    pub fn compile(&mut self, bytes: &[u8]) -> Result<String, String> {
        let mut bodies = Vec::new();
        for payload in Parser::new(0).parse_all(bytes) {
            match payload.map_err(|e| e.to_string())? {
                Payload::TypeSection(reader) => {
                    for rec_group in reader {
                        let rec_group = rec_group.map_err(|e| e.to_string())?;
                        for sub_type in rec_group.into_types() {
                            if let wasmparser::CompositeType::Func(func_type) =
                                sub_type.composite_type
                            {
                                self.func_types.push(func_type);
                            }
                        }
                    }
                }
                Payload::ImportSection(reader) => {
                    for import in reader {
                        let import = import.map_err(|e| e.to_string())?;
                        match import.ty {
                            wasmparser::TypeRef::Func(_) => self.num_imports += 1,
                            wasmparser::TypeRef::Memory(memory) => {
                                self.memory_pages = memory.initial.max(1);
                            }
                            _ => {}
                        }
                    }
                }
                Payload::MemorySection(reader) => {
                    for memory in reader {
                        let memory = memory.map_err(|e| e.to_string())?;
                        self.memory_pages = memory.initial.max(1);
                    }
                }
                Payload::FunctionSection(reader) => {
                    for type_index in reader {
                        self.func_type_indices.push(type_index.map_err(|e| e.to_string())?);
                    }
                }
                Payload::GlobalSection(reader) => {
                    for global in reader {
                        let global = global.map_err(|e| e.to_string())?;
                        let mut ops = global.init_expr.get_operators_reader();
                        let value = match ops.read().map_err(|e| e.to_string())? {
                            Operator::I32Const { value } => value as i64,
                            Operator::I64Const { value } => value,
                            _ => 0,
                        };
                        self.globals.push(value);
                    }
                }
                Payload::ExportSection(reader) => {
                    for export in reader {
                        let export = export.map_err(|e| e.to_string())?;
                        if export.kind == wasmparser::ExternalKind::Func {
                            self.exports.push((export.name.to_string(), export.index));
                        }
                    }
                }
                Payload::DataSection(reader) => {
                    for data in reader {
                        let data = data.map_err(|e| e.to_string())?;
                        if let wasmparser::DataKind::Active { offset_expr, .. } = data.kind {
                            let mut ops = offset_expr.get_operators_reader();
                            if let Ok(Operator::I32Const { value }) = ops.read() {
                                self.data.push((value as u32, data.data.to_vec()));
                            }
                        }
                    }
                }
                Payload::CodeSectionEntry(body) => bodies.push(body),
                _ => {}
            }
        }

        // words of memory -> trie depth, so no two in-bounds addresses alias
        let words = (self.memory_pages * 65536 / 4).max(1);
        let needed = self
            .bits_override
            .unwrap_or_else(|| (64 - (words - 1).leading_zeros()).max(1) as usize);
        // round up so the address splits into whole digits
        let levels = (needed + self.digit_bits - 1) / self.digit_bits;
        self.trie_bits = levels * self.digit_bits;

        let mut out = String::new();
        out.push_str(&self.emit_prelude());
        out.push_str(&self.emit_initial_memory());

        // Exported functions are compiled *metered*: their blocks charge fuel
        // and can suspend. Anything they call is compiled *unmetered* and runs
        // to completion inside the caller's evaluation, because suspending
        // mid-call would need a call stack in the state. Deep or recursive
        // callees therefore have to fit in one evaluation.
        let mut entries = Vec::new();
        let mut wanted: Vec<usize> = Vec::new();
        for (name, export_index) in self.exports.clone() {
            if export_index < self.num_imports {
                continue;
            }
            let defined = (export_index - self.num_imports) as usize;
            let (func_type, body) = self.function(defined, &bodies)?;
            let (blocks, num_locals) = self.compile_function(defined, body, &func_type, true)?;
            for block in &blocks {
                out.push_str(&block.body);
                out.push('\n');
            }
            entries.push(self.emit_entry(&name, defined, &func_type, num_locals, &blocks));
            for callee in self.callees(body)? {
                if !wanted.contains(&callee) {
                    wanted.push(callee);
                }
            }
        }

        // transitively close over calls, then emit each callee once
        let mut done: Vec<usize> = Vec::new();
        while let Some(callee) = wanted.pop() {
            if done.contains(&callee) {
                continue;
            }
            done.push(callee);
            let (func_type, body) = self.function(callee, &bodies)?;
            let (blocks, num_locals) = self.compile_function(callee, body, &func_type, false)?;
            for block in &blocks {
                out.push_str(&block.body);
                out.push('\n');
            }
            out.push_str(&self.emit_call_entry(callee, &func_type, num_locals, &blocks));
            for next in self.callees(body)? {
                if !done.contains(&next) {
                    wanted.push(next);
                }
            }
        }

        for entry in entries {
            out.push_str(&entry);
        }
        // whatever specialised shifts and masks the program turned out to need
        let helpers = self.helpers.borrow();
        if !helpers.is_empty() {
            out.push_str("\n// Specialised for the constants this module uses: a shift by a known\n");
            out.push_str("// amount is a character move, and a mask by a known constant is a\n");
            out.push_str("// character-by-character choice. Neither needs an adder.\n");
            for definition in helpers.values() {
                out.push_str(definition);
                out.push('\n');
            }
        }
        Ok(out)
    }

    /// The handful of operations that are genuinely cheaper by hand.
    ///
    /// Measured, per operation, in a 200-iteration loop: ts-type-math costs
    /// ~100µs for anything it has to walk bit by bit, and a hand-written 32-bit
    /// adder built from nibble lookup tables came out *slower* (130µs) - the cost
    /// in tsgo is the instantiation machinery, not the algorithm. What does win
    /// is anything that collapses into a single template-literal conditional:
    /// masks and constant shifts drop to ~10µs, and equality needs no pattern at
    /// all. Those are emitted here; everything else stays on ts-type-math.
    fn emit_fast_math() -> String {
        let mut out = String::new();
        out.push_str("export type $Flip = { '0': '1', '1': '0' }\n\n");
        out.push_str("/// logical not of a wasm boolean (0 or 1)\n");
        out.push_str("export type $Not1<B extends string> =\n");
        out.push_str("  B extends '00000000000000000000000000000000' ? '00000000000000000000000000000001' : '00000000000000000000000000000000'\n\n");
        out.push_str("/// equality is type identity: no bit walking, no pattern match\n");
        out.push_str("export type $Eq<A extends string, B extends string> =\n");
        out.push_str("  A extends B ? '00000000000000000000000000000001' : '00000000000000000000000000000000'\n");
        out.push_str("export type $Ne<A extends string, B extends string> =\n");
        out.push_str("  A extends B ? '00000000000000000000000000000000' : '00000000000000000000000000000001'\n");
        out
    }

    /// The entry point for a called function: takes memory, the caller's
    /// globals and the arguments, and zero-fills the rest of the locals.
    fn emit_call_entry(
        &self,
        func_index: usize,
        func_type: &FuncType,
        num_locals: usize,
        blocks: &[EmittedBlock],
    ) -> String {
        let (num_params, _) = self.func_signature(func_type);
        let entry = blocks.first().map(|b| b.id).unwrap_or(0);
        let mut params = vec!["$M extends $Node".to_string()];
        for i in 0..self.globals.len() {
            params.push(format!("$g{i} extends WasmValue"));
        }
        for i in 0..num_params {
            params.push(format!("$p{i} extends WasmValue"));
        }
        let mut args = vec!["$M".to_string()];
        for i in 0..self.globals.len() {
            args.push(format!("$g{i}"));
        }
        let live: Vec<u32> = blocks
            .first()
            .map(|block| block.live.iter().copied().collect())
            .unwrap_or_default();
        for index in live {
            let i = index as usize;
            args.push(if i < num_params {
                format!("$p{i}")
            } else {
                format!("'{}'", zero())
            });
        }
        let _ = num_locals;
        format!(
            "\nexport type $call{func_index}<{}> =\n  $u{func_index}_{entry}<{}>\n",
            params.join(", "),
            args.join(", ")
        )
    }

    /// type and body of a defined function, by index into the defined functions
    fn function<'b>(
        &self,
        defined: usize,
        bodies: &'b [wasmparser::FunctionBody<'b>],
    ) -> Result<(FuncType, &'b wasmparser::FunctionBody<'b>), String> {
        let body = bodies
            .get(defined)
            .ok_or_else(|| format!("no body for function {defined}"))?;
        let type_index = *self
            .func_type_indices
            .get(defined)
            .ok_or_else(|| format!("no type for function {defined}"))?;
        let func_type = self
            .func_types
            .get(type_index as usize)
            .ok_or_else(|| format!("no type {type_index}"))?
            .clone();
        Ok((func_type, body))
    }

    /// which defined functions this body calls directly
    fn callees(&self, body: &wasmparser::FunctionBody) -> Result<Vec<usize>, String> {
        let mut found = Vec::new();
        for op in body.get_operators_reader().map_err(|e| e.to_string())? {
            if let Operator::Call { function_index } = op.map_err(|e| e.to_string())? {
                if function_index < self.num_imports {
                    return Err(format!(
                        "calls to imported functions are not supported (function {function_index})"
                    ));
                }
                let defined = (function_index - self.num_imports) as usize;
                if !found.contains(&defined) {
                    found.push(defined);
                }
            }
        }
        Ok(found)
    }

    fn emit_prelude(&self) -> String {
        let bits = self.trie_bits;
        let digit = self.digit_bits;
        let fanout = 1usize << digit;
        let levels = bits / digit;
        let skip = 32 - 2 - bits;
        let z = zero();

        // $Slice: pull the addressing bits out of a 32-bit address
        let high: String = (0..skip).map(|i| format!("${{infer _h{i}}}")).collect();
        let mid: String = (0..bits).map(|i| format!("${{infer b{i}}}")).collect();
        let path: String = (0..bits).map(|i| format!("${{b{i}}}")).collect();

        // one digit of the path, as a template pattern and as a value
        let digit_pattern: String = (0..digit).map(|i| format!("${{infer d{i}}}")).collect();
        let digit_value: String = (0..digit).map(|i| format!("${{d{i}}}")).collect();
        let node_pattern: String = (0..fanout)
            .map(|i| format!("infer c{i}"))
            .collect::<Vec<_>>()
            .join(", ");

        // $Sel / $Set: pick and replace one child of a branch node
        let sel_arms: String = (0..fanout)
            .map(|i| {
                format!(
                    "  D extends '{:0width$b}' ? T[{i}] :\n",
                    i,
                    width = digit,
                    i = i
                )
            })
            .collect();
        let set_arms: String = (0..fanout)
            .map(|i| {
                let elements: Vec<String> = (0..fanout)
                    .map(|j| if j == i { "X".to_string() } else { format!("T[{j}]") })
                    .collect();
                format!(
                    "  D extends '{:0width$b}' ? [{}] :\n",
                    i,
                    elements.join(", "),
                    width = digit
                )
            })
            .collect();
        let all_same: String = (0..fanout).map(|_| "T").collect::<Vec<_>>().join(", ");

        format!(
            r#"// Generated by the CFG AOT compiler. Do not edit.
//
// Memory is a sparse {fanout}-way trie over the address bits.
//
// Why a trie: `S['memory'] & Record<Addr, V>` cannot work, because
// intersecting two different literals for one key gives `never` - the second
// write to a word poisons it, and an `i32.store8` is a read-modify-write, so
// four byte stores into one word are enough to lose the word.
//
// Why {fanout}-way and not binary: the state has to come back to the host as text
// between chunks, and the type *printer* elides parts of deeply nested types
// (printing them as `any`) even when the type itself is perfectly correct.
// {levels} levels stays clear of that, and it also costs {levels} instantiations per
// read or write instead of {bits}.
import type {{ Wasm, WasmValue, Convert }} from 'ts-type-math'

export type $Zero = ['{z}']
/// A node is always a tuple: [word] is a leaf, a {fanout}-tuple is a branch.
/// Deliberately not a union - a union constraint makes `infer M extends $Node`
/// distribute, and a write against a distributed memory silently returns two
/// copies of the trie unioned together.
export type $Node = unknown[]
/// Fuel is a string of '1's, one per unit of work. Decrementing takes a prefix
/// off a string, which costs nothing; the obvious `[any, ...infer Rest]` tuple
/// copies every remaining element on every hop instead, and at a few thousand
/// units that dominated the whole frame.
export type $Fuel = string

/// the addressing bits of an address: drop the two byte-offset bits, keep {bits}
export type $Slice<A extends string> =
  A extends `{high}{mid}${{infer _l0}}${{infer _l1}}`
    ? `{path}`
    : never

export type $Word<T> = T extends [infer W extends string] ? W : '{z}'

/// pick child D of a branch node
export type $Sel<T extends unknown[], D extends string> =
{sel_arms}  never

/// replace child D of a branch node with X
export type $Set<T extends unknown[], D extends string, X> =
{set_arms}  never

export type $Get<T, B extends string> =
  B extends `{digit_pattern}${{infer Rest}}`
    ? T extends [{node_pattern}]
      ? $Get<$Sel<[{node_pattern_names}], `{digit_value}`>, Rest>
      : $Word<T>
    : $Word<T>

/// Writing into a leaf that stands for a whole subtree splits it, and every
/// child inherits the leaf: a leaf above the bottom means "every word below me
/// holds this", which is how all-zero subtrees stay shared and cheap.
export type $Put<T, B extends string, V extends string> =
  B extends `{digit_pattern}${{infer Rest}}`
    ? T extends [{node_pattern}]
      ? $Set<[{node_pattern_names}], `{digit_value}`, $Put<$Sel<[{node_pattern_names}], `{digit_value}`>, Rest, V>>
      : $Set<[{all_same}], `{digit_value}`, $Put<T, Rest, V>>
    : [V]

export type $AlignAddr<A extends WasmValue> = Wasm.I32And<A, '11111111111111111111111111111100'>

/// The two low bits of an address, as characters. A byte offset is the last two
/// characters of the address string - no arithmetic needed to find it.
export type $Off<A extends string> =
  A extends `{addr_pattern}` ? `${{a30}}${{a31}}` : never

/// Read one byte out of a word by slicing characters, not by shifting bits.
/// Words are little-endian, so byte 0 is the *last* eight characters.
export type $GetByte<W extends string, O extends string> =
  W extends `{word_pattern}`
    ? O extends '00' ? `{zeros24}{byte0}`
      : O extends '01' ? `{zeros24}{byte1}`
      : O extends '10' ? `{zeros24}{byte2}`
      : `{zeros24}{byte3}`
    : never

/// Replace one byte of a word with the low byte of V, again by slicing.
export type $SetByte<W extends string, O extends string, V extends string> =
  W extends `{word_pattern}`
    ? V extends `{value_pattern}`
      ? O extends '00' ? `{byte3}{byte2}{byte1}{vbyte0}`
        : O extends '01' ? `{byte3}{byte2}{vbyte0}{byte0}`
        : O extends '10' ? `{byte3}{vbyte0}{byte1}{byte0}`
        : `{vbyte0}{byte2}{byte1}{byte0}`
      : never
    : never

export type $ByteOffset<A extends WasmValue> = Wasm.I32And<A, '{three}'>

export type $Read<M extends $Node, A extends WasmValue> = $Get<M, $Slice<A>>
export type $Write<M extends $Node, A extends WasmValue, V extends WasmValue> = $Put<M, $Slice<A>, V>

/// 8-bit access: one trie walk plus one character splice, no arithmetic at all
export type $Load8U<M extends $Node, A extends WasmValue> = $GetByte<$Read<M, A>, $Off<A>>
export type $Load8S<M extends $Node, A extends WasmValue> =
  Wasm.I32ShrS<Wasm.I32Shl<$Load8U<M, A>, '{twentyfour}'>, '{twentyfour}'>
export type $Store8<M extends $Node, A extends WasmValue, V extends WasmValue> =
  $Write<M, A, $SetByte<$Read<M, A>, $Off<A>, V>>

/// 32-bit access: aligned is a plain trie read or write; unaligned falls back to
/// the bit arithmetic, which pong never needs
export type $Load32<M extends $Node, A extends WasmValue> =
  $Off<A> extends '00'
    ? $Read<M, A>
    : Wasm.I32Or<
        Wasm.I32ShrU<$Read<M, A>, Wasm.I32Shl<$ByteOffset<A>, '{three}'>>,
        Wasm.I32Shl<$Read<M, Wasm.I32Add<$AlignAddr<A>, '{four}'>>, Wasm.I32Sub<'{thirtytwo}', Wasm.I32Shl<$ByteOffset<A>, '{three}'>>>
      >
export type $Store32<M extends $Node, A extends WasmValue, V extends WasmValue> =
  $Off<A> extends '00'
    ? $Write<M, A, V>
    : $Store16<$Store16<M, A, V>, Wasm.I32Add<A, '{two}'>, Wasm.I32ShrU<V, '{sixteen}'>>

/// 16-bit access: two byte splices when it stays inside a word
export type $Load16U<M extends $Node, A extends WasmValue> =
  $Off<A> extends '11'
    ? Wasm.I32Or<
        Wasm.I32ShrU<$Read<M, A>, '{twentyfour}'>,
        Wasm.I32Shl<Wasm.I32And<$Read<M, Wasm.I32Add<$AlignAddr<A>, '{four}'>>, '{ff}'>, '{eight}'>
      >
    : Wasm.I32Or<$Load8U<M, A>, Wasm.I32Shl<$GetByte<$Read<M, A>, $Next<$Off<A>>>, '{eight}'>>
export type $Load16S<M extends $Node, A extends WasmValue> =
  Wasm.I32ShrS<Wasm.I32Shl<$Load16U<M, A>, '{sixteen}'>, '{sixteen}'>
export type $Next<O extends string> = O extends '00' ? '01' : O extends '01' ? '10' : O extends '10' ? '11' : '00'
export type $Store16<M extends $Node, A extends WasmValue, V extends WasmValue> =
  $Off<A> extends '11'
    ? $Store8<$Store8<M, A, V>, Wasm.I32Add<A, '{one}'>, Wasm.I32ShrU<V, '{eight}'>>
    : $Write<M, A, $SetByte<$SetByte<$Read<M, A>, $Off<A>, V>, $Next<$Off<A>>, Wasm.I32ShrU<V, '{eight}'>>>

export type $ToNumber<V> = Convert.WasmValue.ToTSNumber<V & string, 'i32'>

{fast_math}
"#,
            fanout = fanout,
            levels = levels,
            bits = bits,
            z = z,
            one = bits32(1),
            two = bits32(2),
            three = bits32(3),
            four = bits32(4),
            eight = bits32(8),
            sixteen = bits32(16),
            twentyfour = bits32(24),
            thirtytwo = bits32(32),
            ff = bits32(0xff),
            high = high,
            mid = mid,
            path = path,
            addr_pattern = (0..32)
                .map(|i| format!("${{infer a{i}}}"))
                .collect::<String>(),
            word_pattern = (0..32)
                .map(|i| format!("${{infer w{i}}}"))
                .collect::<String>(),
            value_pattern = (0..32)
                .map(|i| format!("${{infer v{i}}}"))
                .collect::<String>(),
            fast_math = Self::emit_fast_math(),
            zeros24 = "0".repeat(24),
            byte3 = (0..8).map(|i| format!("${{w{i}}}")).collect::<String>(),
            byte2 = (8..16).map(|i| format!("${{w{i}}}")).collect::<String>(),
            byte1 = (16..24).map(|i| format!("${{w{i}}}")).collect::<String>(),
            byte0 = (24..32).map(|i| format!("${{w{i}}}")).collect::<String>(),
            vbyte0 = (24..32).map(|i| format!("${{v{i}}}")).collect::<String>(),
            digit_pattern = digit_pattern,
            digit_value = digit_value,
            node_pattern = node_pattern,
            node_pattern_names = (0..fanout)
                .map(|i| format!("c{i}"))
                .collect::<Vec<_>>()
                .join(", "),
            sel_arms = sel_arms,
            set_arms = set_arms,
            all_same = all_same,
        )
    }

    /// The data segments as a trie literal, so the first chunk starts from a
    /// concrete memory image instead of building one at type level.
    fn emit_initial_memory(&self) -> String {
        let mut words: HashMap<u32, u32> = HashMap::new();
        for (offset, bytes) in &self.data {
            for (i, byte) in bytes.iter().enumerate() {
                let addr = offset + i as u32;
                let word_addr = addr & !3;
                let shift = (addr & 3) * 8;
                let entry = words.entry(word_addr).or_insert(0);
                *entry |= (*byte as u32) << shift;
            }
        }
        for (_, value) in self.globals.iter().enumerate() {
            let _ = value;
        }
        let mut sorted: Vec<(u32, u32)> = words.into_iter().filter(|(_, v)| *v != 0).collect();
        sorted.sort_by_key(|(addr, _)| *addr);
        let literal = self.trie_literal(&sorted);
        format!("\nexport type $InitialMemory = {literal}\n")
    }

    /// Build the nested-tuple literal for a set of word writes, sharing the
    /// zero marker for every subtree nothing was written into.
    fn trie_literal(&self, words: &[(u32, u32)]) -> String {
        let digit = self.digit_bits;
        let fanout = 1usize << digit;
        let levels = self.trie_bits / digit;
        fn build(words: &[(u32, u32)], level: usize, levels: usize, digit: usize, fanout: usize) -> String {
            if words.is_empty() {
                return "$Zero".to_string();
            }
            if level == levels {
                return format!("['{:032b}']", words[0].1);
            }
            let shift = (levels - 1 - level) * digit;
            let mut buckets: Vec<Vec<(u32, u32)>> = vec![Vec::new(); fanout];
            for &(addr, value) in words {
                let index = ((addr >> 2) >> shift) as usize & (fanout - 1);
                buckets[index].push((addr, value));
            }
            let children: Vec<String> = buckets
                .iter()
                .map(|bucket| build(bucket, level + 1, levels, digit, fanout))
                .collect();
            format!("[{}]", children.join(", "))
        }
        build(words, 0, levels, digit, fanout)
    }

    fn func_signature(&self, func_type: &FuncType) -> (usize, usize) {
        (func_type.params().len(), func_type.results().len())
    }

    fn compile_function(
        &self,
        func_index: usize,
        body: &wasmparser::FunctionBody,
        func_type: &FuncType,
        metered: bool,
    ) -> Result<(Vec<EmittedBlock>, usize), String> {
        let (num_params, num_results) = self.func_signature(func_type);
        if num_results > 1 {
            return Err("multiple return values are not supported yet".to_string());
        }
        for param in func_type.params() {
            if *param != ValType::I32 {
                return Err(format!("only i32 params are supported, found {param:?}"));
            }
        }

        let mut num_locals = num_params;
        for local in body.get_locals_reader().map_err(|e| e.to_string())? {
            let (count, ty) = local.map_err(|e| e.to_string())?;
            if ty != ValType::I32 {
                return Err(format!("only i32 locals are supported, found {ty:?}"));
            }
            num_locals += count as usize;
        }

        let ops: Vec<Operator> = body
            .get_operators_reader()
            .map_err(|e| e.to_string())?
            .into_iter()
            .collect::<Result<_, _>>()
            .map_err(|e| e.to_string())?;

        let mut compiler = FunctionCfg {
            module: self,
            func_index,
            metered,
            ops: &ops,
            num_locals,
            num_results,
            blocks: Vec::new(),
            sites: Vec::new(),
            successors: Vec::new(),
            pending: Vec::new(),
            next_id: 0,
            ends: end_map(&ops)?,
        };
        compiler.run()?;
        Ok((compiler.blocks, num_locals))
    }

    fn emit_entry(
        &self,
        name: &str,
        func_index: usize,
        func_type: &FuncType,
        num_locals: usize,
        blocks: &[EmittedBlock],
    ) -> String {
        let (num_params, _) = self.func_signature(func_type);
        let entry = blocks.first().map(|b| b.id).unwrap_or(0);
        let params: Vec<String> = (0..num_params).map(|i| format!("$p{i}")).collect();
        let decls: Vec<String> = params
            .iter()
            .map(|p| format!("{p} extends WasmValue"))
            .collect();
        let mut args: Vec<String> = vec!["$F".to_string(), "$M".to_string()];
        for i in 0..self.globals.len() {
            args.push(format!("'{}'", bits32(self.globals[i] as i32)));
        }
        let live: Vec<u32> = blocks
            .first()
            .map(|block| block.live.iter().copied().collect())
            .unwrap_or_default();
        for index in live {
            let i = index as usize;
            args.push(if i < num_params {
                params[i].clone()
            } else {
                format!("'{}'", zero())
            });
        }
        let _ = num_locals;
        let decl_list = if decls.is_empty() {
            String::new()
        } else {
            format!(", {}", decls.join(", "))
        };
        format!(
            "\nexport type ${name}<$F extends string, $M extends $Node{decl_list}> =\n  $b{func_index}_{entry}<{}>\n",
            args.join(", ")
        )
    }
}

/// Map each structured-instruction position to the position of its `End`, and
/// each `If` to its `Else` when it has one.
fn end_map(ops: &[Operator]) -> Result<HashMap<usize, (usize, Option<usize>)>, String> {
    let mut map = HashMap::new();
    let mut stack: Vec<(usize, Option<usize>)> = Vec::new();
    for (pos, op) in ops.iter().enumerate() {
        match op {
            Operator::Block { .. } | Operator::Loop { .. } | Operator::If { .. } => {
                stack.push((pos, None));
            }
            Operator::Else => {
                if let Some(top) = stack.last_mut() {
                    top.1 = Some(pos);
                }
            }
            Operator::End => {
                if let Some((start, else_pos)) = stack.pop() {
                    map.insert(start, (pos, else_pos));
                }
            }
            _ => {}
        }
    }
    if !stack.is_empty() {
        return Err("unbalanced control flow".to_string());
    }
    Ok(map)
}

struct FunctionCfg<'a> {
    module: &'a CfgCompiler,
    func_index: usize,
    /// metered blocks charge fuel and can suspend; unmetered ones are callees
    /// that must run to completion inside the caller's evaluation
    metered: bool,
    ops: &'a [Operator<'a>],
    num_locals: usize,
    num_results: usize,
    blocks: Vec<EmittedBlock>,
    /// (target block, the caller's local values) for every jump, in order
    sites: Vec<(usize, Vec<String>)>,
    /// successors of the block currently being compiled
    successors: Vec<usize>,
    pending: Vec<Pending>,
    next_id: usize,
    ends: HashMap<usize, (usize, Option<usize>)>,
}

impl<'a> FunctionCfg<'a> {
    fn fresh_id(&mut self) -> usize {
        let id = self.next_id;
        self.next_id += 1;
        id
    }

    fn block_name(&self, id: usize) -> String {
        let flavour = if self.metered { "b" } else { "u" };
        format!("${flavour}{}_{}", self.func_index, id)
    }

    fn run(&mut self) -> Result<(), String> {
        let entry = self.fresh_id();
        self.pending.push(Pending {
            id: entry,
            pos: 0,
            labels: vec![Label {
                kind: LabelKind::Block,
                target: usize::MAX, // function return
                exit: usize::MAX,
                arity: self.num_results,
                exit_arity: self.num_results,
                stack_floor: 0,
            }],
            stack: Vec::new(),
        });
        while let Some(pending) = self.pending.pop() {
            let block = self.compile_block(pending)?;
            self.blocks.push(block);
            if self.blocks.len() > 4000 {
                return Err("function produced too many blocks".to_string());
            }
        }
        self.blocks.sort_by_key(|b| b.id);
        self.compute_liveness();
        self.substitute_locals();
        Ok(())
    }

    /// Backward dataflow: a local is live entering a block if the block reads it
    /// before writing it, or if any successor needs it and this block does not
    /// overwrite it first.
    ///
    /// Worth about 25% on a real frame, measured: pong-tiny goes from 3.8 to
    /// 4.6 frames per second and the pixel game from 0.33s to 0.245s a frame,
    /// with every pixel still identical to the wasm engine. Mean parameters per
    /// block drops from 17 to 8.5.
    ///
    /// A caution about why, since it is easy to get wrong: type arguments are
    /// not individually expensive. A hand-written loop carrying 20 string
    /// parameters costs the same per iteration as one carrying 2. What this
    /// saves is the size of the state threaded through every hop and rebuilt in
    /// every suspend payload, not a per-argument fee.
    fn compute_liveness(&mut self) {
        let index_of: HashMap<usize, usize> = self
            .blocks
            .iter()
            .enumerate()
            .map(|(index, block)| (block.id, index))
            .collect();
        for block in &mut self.blocks {
            block.live = block.reads.clone();
        }
        loop {
            let mut changed = false;
            for position in (0..self.blocks.len()).rev() {
                let mut live = self.blocks[position].reads.clone();
                for successor in self.blocks[position].successors.clone() {
                    let Some(&target) = index_of.get(&successor) else {
                        continue;
                    };
                    for local in self.blocks[target].live.clone() {
                        if !self.blocks[position].writes.contains(&local) {
                            live.insert(local);
                        }
                    }
                }
                if live != self.blocks[position].live {
                    self.blocks[position].live = live;
                    changed = true;
                }
            }
            if !changed {
                break;
            }
        }
    }

    /// Replace the placeholders left during compilation with the locals each
    /// block turned out to need.
    fn substitute_locals(&mut self) {
        let live: HashMap<usize, Vec<u32>> = self
            .blocks
            .iter()
            .map(|block| (block.id, block.live.iter().copied().collect()))
            .collect();
        let empty = Vec::new();
        let sites = std::mem::take(&mut self.sites);
        for block in &mut self.blocks {
            let mut body = std::mem::take(&mut block.body);
            // parameters, and the payload handed back when this block suspends
            let wanted = live.get(&block.id).unwrap_or(&empty);
            let params: Vec<String> = wanted
                .iter()
                .map(|index| format!("$l{index} extends WasmValue"))
                .collect();
            let payload: Vec<String> = wanted.iter().map(|index| format!("$l{index}")).collect();
            body = fill_marker(body, &format!("\u{1}P{}\u{1}", block.id), &params);
            body = fill_marker(body, &format!("\u{1}S{}\u{1}", block.id), &payload);
            // call sites: pass only what the target reads
            while let Some(start) = body.find("\u{1}L") {
                let end = body[start + 2..].find('\u{1}').map(|at| start + 2 + at).unwrap_or(body.len());
                let site: usize = body[start + 2..end].parse().unwrap_or(0);
                let (target, values) = &sites[site];
                let selected: Vec<String> = live
                    .get(target)
                    .unwrap_or(&empty)
                    .iter()
                    .filter_map(|index| values.get(*index as usize).cloned())
                    .collect();
                if selected.is_empty() {
                    // drop a separator too, so no empty argument is left behind
                    body.replace_range(start..end + 1, "");
                    if body[start..].starts_with(", ") {
                        body.replace_range(start..start + 2, "");
                    } else if body[..start].ends_with(", ") {
                        body.replace_range(start - 2..start, "");
                    }
                } else {
                    body.replace_range(start..end + 1, &selected.join(", "));
                }
            }
            block.body = body;
        }
        self.sites = sites;
    }

    /// locals live entering the function's first block
    fn entry_live(&self) -> Vec<u32> {
        self.blocks
            .first()
            .map(|block| block.live.iter().copied().collect())
            .unwrap_or_default()
    }

    /// How many instructions a block may chain before it is cut in two.
    ///
    /// A block is a chain of nested `infer`s, one per instruction, and tsgo
    /// resolves that shape in time exponential in its depth. Measured, on a
    /// chain of i32 adds: 16 deep takes 19ms, 18 takes 57ms, 20 takes 213ms, 22
    /// takes 798ms, 24 takes 3.2s, and 32 had not finished after 17 minutes.
    ///
    /// So a long basic block is not slow, it is fatal - and nothing stops a
    /// program from having one. Cutting the chain costs a hop, about 200µs,
    /// which buys back an unbounded amount.
    ///
    /// The cliff is not the only reason to cut early. Swept against the pixel
    /// game, a steady frame takes 0.09s at a cap of 12, 0.06s at 8, and 0.06s
    /// at 6 and 4 - the curve is still falling well below the knee, because a
    /// shallower chain is cheaper to resolve even where it is not exponential.
    /// It flattens at about 6, and hops start to outweigh the saving below
    /// that.
    const DEPTH_CAP: usize = 6;

    fn compile_block(&mut self, pending: Pending) -> Result<EmittedBlock, String> {
        let mut env = BlockEnv {
            helpers: Rc::clone(&self.module.helpers),
            memory: "$M".to_string(),
            globals: (0..self.module.globals.len())
                .map(|i| format!("$g{i}"))
                .collect(),
            locals: (0..self.num_locals).map(|i| format!("$l{i}")).collect(),
            stack: pending.stack.clone(),
            bindings: Vec::new(),
            reads: BTreeSet::new(),
            writes: BTreeSet::new(),
            computed: HashMap::new(),
            next_temp: 0,
            stores: 0,
        };
        let mut labels = pending.labels.clone();
        let mut pos = pending.pos;
        let terminator;

        loop {
            if pos >= self.ops.len() {
                terminator = self.emit_return(&mut env)?;
                break;
            }
            // cut the chain before it reaches the depth where the checker
            // falls off a cliff, handing the rest to a fresh block
            if env.bindings.len() >= Self::DEPTH_CAP {
                let continuation = self.fresh_id();
                let stack_params: Vec<String> =
                    (0..env.stack.len()).map(|i| format!("$k{i}")).collect();
                let arity = env.stack.len();
                self.pending.push(Pending {
                    id: continuation,
                    pos,
                    labels: labels.clone(),
                    stack: stack_params,
                });
                terminator = self.call_block(continuation, &env, 0, arity);
                break;
            }
            let op = &self.ops[pos];
            pos += 1;
            match self.step(op, pos, &mut env, &mut labels)? {
                Step::Continue => {}
                Step::Jump(next_pos) => {
                    pos = next_pos;
                }
                Step::Terminate(text) => {
                    terminator = text;
                    break;
                }
            }
        }

        // a hop plus this block's own stores: both consume the checker's depth
        // budget, so both have to be paid for out of the same fuel
        let cost = 1 + env.stores;
        let body = self.render_block(&pending, &env, &terminator, cost);
        Ok(EmittedBlock {
            id: pending.id,
            stack_arity: pending.stack.len(),
            body,
            cost,
            reads: env.reads.clone(),
            writes: env.writes.clone(),
            successors: std::mem::take(&mut self.successors),
            live: BTreeSet::new(),
        })
    }

    /// Wrap the block's terminator in its bindings, fuel check and parameters.
    fn render_block(&self, pending: &Pending, env: &BlockEnv, terminator: &str, cost: usize) -> String {
        let mut params = if self.metered {
            vec!["$F extends string".to_string(), "$M extends $Node".to_string()]
        } else {
            vec!["$M extends $Node".to_string()]
        };
        for i in 0..self.module.globals.len() {
            params.push(format!("$g{i} extends WasmValue"));
        }
        params.push(format!("\u{1}P{}\u{1}", pending.id));
        for name in &pending.stack {
            params.push(format!("{name} extends WasmValue"));
        }

        let mut inner = String::new();
        for (name, constraint, expr) in &env.bindings {
            // most bindings name one value; a call binds a whole result pattern
            if constraint.is_empty() {
                inner.push_str(&format!("{expr} extends {name}\n  ? "));
            } else {
                inner.push_str(&format!("{expr} extends infer {name} extends {constraint}\n  ? "));
            }
        }
        inner.push_str(terminator);
        for _ in &env.bindings {
            inner.push_str("\n  : never");
        }

        let body = if !self.metered {
            format!("  {}", indent(&inner, 2))
        } else {
            // out of fuel: hand the block id and everything live back to the host
            let mut live = vec!["$M".to_string()];
            for i in 0..self.module.globals.len() {
                live.push(format!("$g{i}"));
            }
            live.push(format!("\u{1}S{}\u{1}", pending.id));
            live.extend(pending.stack.iter().cloned());
            let burn: String = std::iter::repeat('1').take(cost).collect();
            format!(
                "  $F extends `{burn}${{infer $F1}}`\n  ? {}\n  : ['s', '{}', {}]",
                indent(&inner.replace("$F", "$F1"), 2),
                format!("{}_{}", self.func_index, pending.id),
                live.join(", ")
            )
        };

        format!(
            "\nexport type {}<{}> =\n{}\n",
            self.block_name(pending.id),
            params.join(", "),
            body
        )
    }

    fn emit_return(&self, env: &mut BlockEnv) -> Result<String, String> {
        let mut parts = vec!["'r'".to_string(), env.memory.clone()];
        // a callee also hands its globals back, so writes to them are not lost
        if !self.metered {
            parts.extend(env.globals.iter().cloned());
        }
        if self.num_results > 0 {
            parts.push(
                env.stack
                    .last()
                    .cloned()
                    .unwrap_or_else(|| format!("'{}'", zero())),
            );
        }
        Ok(format!("[{}]", parts.join(", ")))
    }

    /// Tail-call a block, passing the stack it expects: everything below the
    /// label, then the operands it consumes off the top.
    fn call_block(&mut self, id: usize, env: &BlockEnv, floor: usize, arity: usize) -> String {
        let mut args = if self.metered {
            vec!["$F".to_string(), env.memory.clone()]
        } else {
            vec![env.memory.clone()]
        };
        args.extend(env.globals.iter().cloned());
        // which locals this target actually needs is only known once the whole
        // function is compiled, so leave a marker and fill it in later
        args.push(self.local_site(id, env));
        let floor = floor.min(env.stack.len());
        args.extend(env.stack[..floor].iter().cloned());
        let take = arity.min(env.stack.len() - floor);
        args.extend(env.stack[env.stack.len() - take..].iter().cloned());
        format!("{}<{}>", self.block_name(id), args.join(", "))
    }

    /// leading arguments every block takes: fuel (when metered), memory, globals, locals
    fn entry_args(&mut self, id: usize, env: &BlockEnv) -> Vec<String> {
        let mut args = if self.metered {
            vec!["$F".to_string(), env.memory.clone()]
        } else {
            vec![env.memory.clone()]
        };
        args.extend(env.globals.iter().cloned());
        args.push(self.local_site(id, env));
        args
    }

    /// Record a call site's local values and return the placeholder that will
    /// become the subset the target actually reads.
    fn local_site(&mut self, target: usize, env: &BlockEnv) -> String {
        self.sites.push((target, env.locals.clone()));
        self.successors.push(target);
        format!("\u{1}L{}\u{1}", self.sites.len() - 1)
    }

    /// `br depth`
    fn jump(&mut self, labels: &[Label], depth: u32, env: &BlockEnv) -> Result<String, String> {
        let index = labels
            .len()
            .checked_sub(1 + depth as usize)
            .ok_or_else(|| format!("br depth {depth} escapes the function"))?;
        let label = labels
            .get(index)
            .ok_or_else(|| format!("no label at depth {depth}"))?
            .clone();
        if label.target == usize::MAX {
            let mut env2 = env.clone();
            return self.emit_return(&mut env2);
        }
        Ok(self.call_block(label.target, env, label.stack_floor, label.arity))
    }

    /// falling off the innermost label's `end`
    fn jump_exit(&mut self, labels: &[Label], env: &BlockEnv) -> Result<String, String> {
        let label = labels
            .last()
            .ok_or_else(|| "end without a label".to_string())?
            .clone();
        if label.exit == usize::MAX {
            let mut env2 = env.clone();
            return self.emit_return(&mut env2);
        }
        Ok(self.call_block(label.exit, env, label.stack_floor, label.exit_arity))
    }

    fn step(
        &mut self,
        op: &Operator,
        pos: usize,
        env: &mut BlockEnv,
        labels: &mut Vec<Label>,
    ) -> Result<Step, String> {
        use Operator::*;
        match op {
            I32Const { value } => {
                env.push(format!("'{}'", bits32(*value)));
                Ok(Step::Continue)
            }
            LocalGet { local_index } => {
                let value = env.local(*local_index)?;
                env.push(value);
                Ok(Step::Continue)
            }
            LocalSet { local_index } => {
                let value = env.pop();
                env.set_local(*local_index, value)?;
                Ok(Step::Continue)
            }
            LocalTee { local_index } => {
                let value = env.peek();
                env.set_local(*local_index, value)?;
                Ok(Step::Continue)
            }
            GlobalGet { global_index } => {
                let value = env
                    .globals
                    .get(*global_index as usize)
                    .cloned()
                    .ok_or_else(|| format!("global {global_index} out of range"))?;
                env.push(value);
                Ok(Step::Continue)
            }
            GlobalSet { global_index } => {
                let value = env.pop();
                let index = *global_index as usize;
                if index >= env.globals.len() {
                    return Err(format!("global {index} out of range"));
                }
                let bound = env.bind(&value, "WasmValue");
                env.globals[index] = bound;
                Ok(Step::Continue)
            }
            Drop => {
                env.pop();
                Ok(Step::Continue)
            }
            Nop => Ok(Step::Continue),
            Select => {
                let cond = env.pop();
                let else_val = env.pop();
                let then_val = env.pop();
                let chosen = format!("({cond} extends '{z}' ? {else_val} : {then_val})", z = zero());
                let named = env.bind(&chosen, "WasmValue");
                env.push(named);
                Ok(Step::Continue)
            }

            // arithmetic and comparison
            I32Add => env.binary("Wasm.I32Add", Ok(Step::Continue)),
            I32Sub => env.binary("Wasm.I32Sub", Ok(Step::Continue)),
            I32Mul => env.multiply(Ok(Step::Continue)),
            I32DivS => env.binary("Wasm.I32DivS", Ok(Step::Continue)),
            I32DivU => env.binary("Wasm.I32DivU", Ok(Step::Continue)),
            I32RemS => env.binary("Wasm.I32RemS", Ok(Step::Continue)),
            I32RemU => env.binary("Wasm.I32RemU", Ok(Step::Continue)),
            I32And => env.bitwise("And", "Wasm.I32And", Ok(Step::Continue)),
            I32Or => env.bitwise("Or", "Wasm.I32Or", Ok(Step::Continue)),
            I32Xor => env.bitwise("Xor", "Wasm.I32Xor", Ok(Step::Continue)),
            I32Shl => env.shift("Wasm.I32Shl", ShiftKind::Left, Ok(Step::Continue)),
            I32ShrU => env.shift("Wasm.I32ShrU", ShiftKind::RightUnsigned, Ok(Step::Continue)),
            I32ShrS => env.shift("Wasm.I32ShrS", ShiftKind::RightSigned, Ok(Step::Continue)),
            I32Rotl => env.binary("Wasm.I32Rotl", Ok(Step::Continue)),
            I32Rotr => env.binary("Wasm.I32Rotr", Ok(Step::Continue)),
            I32Eq => env.binary("$Eq", Ok(Step::Continue)),
            I32Ne => env.binary("$Ne", Ok(Step::Continue)),
            I32LtS => env.binary("Wasm.I32LtS", Ok(Step::Continue)),
            I32LtU => env.binary("Wasm.I32LtU", Ok(Step::Continue)),
            I32GtS => env.binary("Wasm.I32GtS", Ok(Step::Continue)),
            I32GtU => env.binary("Wasm.I32GtU", Ok(Step::Continue)),
            I32LeS => env.binary("Wasm.I32LeS", Ok(Step::Continue)),
            I32LeU => env.binary("Wasm.I32LeU", Ok(Step::Continue)),
            I32GeS => env.binary("Wasm.I32GeS", Ok(Step::Continue)),
            I32GeU => env.binary("Wasm.I32GeU", Ok(Step::Continue)),
            I32Eqz => env.eqz(Ok(Step::Continue)),
            I32Clz => env.unary("Wasm.I32Clz", Ok(Step::Continue)),
            I32Ctz => env.unary("Wasm.I32Ctz", Ok(Step::Continue)),
            I32Popcnt => env.unary("Wasm.I32Popcnt", Ok(Step::Continue)),

            // memory
            I32Load { memarg } => env.load("$Load32", memarg.offset, Ok(Step::Continue)),
            I32Load8U { memarg } => env.load("$Load8U", memarg.offset, Ok(Step::Continue)),
            I32Load8S { memarg } => env.load("$Load8S", memarg.offset, Ok(Step::Continue)),
            I32Load16U { memarg } => env.load("$Load16U", memarg.offset, Ok(Step::Continue)),
            I32Load16S { memarg } => env.load("$Load16S", memarg.offset, Ok(Step::Continue)),
            I32Store { memarg } => env.store("$Store32", memarg.offset, Ok(Step::Continue)),
            I32Store8 { memarg } => env.store("$Store8", memarg.offset, Ok(Step::Continue)),
            I32Store16 { memarg } => env.store("$Store16", memarg.offset, Ok(Step::Continue)),
            MemorySize { .. } => {
                env.push(format!("'{}'", bits32(self.module.memory_pages as i32)));
                Ok(Step::Continue)
            }

            // control flow
            Block { blockty } => {
                let (end_pos, _) = *self
                    .ends
                    .get(&(pos - 1))
                    .ok_or_else(|| "block without end".to_string())?;
                let arity = block_arity(blockty)?;
                let join = self.fresh_id();
                let floor = env.stack.len();
                self.push_join(join, end_pos + 1, labels, floor, arity)?;
                labels.push(Label {
                    kind: LabelKind::Block,
                    target: join,
                    exit: join,
                    arity,
                    exit_arity: arity,
                    stack_floor: floor,
                });
                Ok(Step::Continue)
            }
            Loop { blockty } => {
                let (end_pos, _) = *self
                    .ends
                    .get(&(pos - 1))
                    .ok_or_else(|| "loop without end".to_string())?;
                let arity = block_arity(blockty)?;
                let floor = env.stack.len();
                // where control lands when the loop finishes
                let exit = self.fresh_id();
                self.push_join(exit, end_pos + 1, labels, floor, arity)?;
                let header = self.fresh_id();
                // the loop header is a checkpoint: this is where a chunk stops
                let mut header_labels = labels.clone();
                header_labels.push(Label {
                    kind: LabelKind::Loop,
                    target: header,
                    exit,
                    arity: 0, // MVP loops take no parameters
                    exit_arity: arity,
                    stack_floor: floor,
                });
                self.pending.push(Pending {
                    id: header,
                    pos,
                    labels: header_labels,
                    stack: (0..floor).map(|i| format!("$k{i}")).collect(),
                });
                // entering the loop is a tail call to its header
                Ok(Step::Terminate(self.call_block(header, env, floor, 0)))
            }
            If { blockty } => {
                let (end_pos, else_pos) = *self
                    .ends
                    .get(&(pos - 1))
                    .ok_or_else(|| "if without end".to_string())?;
                let arity = block_arity(blockty)?;
                let cond = env.pop();
                let join = self.fresh_id();
                let floor = env.stack.len();
                self.push_join(join, end_pos + 1, labels, floor, arity)?;
                let mut inner_labels = labels.clone();
                inner_labels.push(Label {
                    kind: LabelKind::Block,
                    target: join,
                    exit: join,
                    arity,
                    exit_arity: arity,
                    stack_floor: floor,
                });
                // the branch bodies take fresh parameters; the values on the
                // stack right now travel as arguments. Naming them after the
                // expressions themselves collides as soon as two stack slots
                // hold the same value, which folded wat does constantly.
                let carried = fresh_stack(env.stack.len());
                let then_id = self.fresh_id();
                self.pending.push(Pending {
                    id: then_id,
                    pos,
                    labels: inner_labels.clone(),
                    stack: carried.clone(),
                });
                let else_id = self.fresh_id();
                self.pending.push(Pending {
                    id: else_id,
                    pos: else_pos.map(|p| p + 1).unwrap_or(end_pos),
                    labels: inner_labels,
                    stack: carried,
                });
                let mut then_args = self.entry_args(then_id, env);
                then_args.extend(env.stack.iter().cloned());
                let mut else_args = self.entry_args(else_id, env);
                else_args.extend(env.stack.iter().cloned());
                Ok(Step::Terminate(format!(
                    "{cond} extends '{z}'\n  ? {}<{}>\n  : {}<{}>",
                    self.block_name(else_id),
                    else_args.join(", "),
                    self.block_name(then_id),
                    then_args.join(", "),
                    z = zero()
                )))
            }
            Else => {
                // reached by falling out of a then-branch
                let text = self.jump_exit(labels, env)?;
                Ok(Step::Terminate(text))
            }
            End => {
                let text = self.jump_exit(labels, env)?;
                Ok(Step::Terminate(text))
            }
            Br { relative_depth } => {
                let text = self.jump(labels, *relative_depth, env)?;
                Ok(Step::Terminate(text))
            }
            BrIf { relative_depth } => {
                let cond = env.pop();
                let taken = self.jump(labels, *relative_depth, env)?;
                // the fall-through is its own block, so both sides are tail calls
                let fall_id = self.fresh_id();
                self.pending.push(Pending {
                    id: fall_id,
                    pos,
                    labels: labels.clone(),
                    stack: fresh_stack(env.stack.len()),
                });
                let mut args = self.entry_args(fall_id, env);
                args.extend(env.stack.iter().cloned());
                Ok(Step::Terminate(format!(
                    "{cond} extends '{z}'\n  ? {}<{}>\n  : {taken}",
                    self.block_name(fall_id),
                    args.join(", "),
                    z = zero()
                )))
            }
            BrTable { targets } => {
                let index = env.pop();
                let bound = env.bind(&index, "WasmValue");
                let mut arms = Vec::new();
                for (case, depth) in targets.targets().enumerate() {
                    let depth = depth.map_err(|e| e.to_string())?;
                    let target = self.jump(labels, depth, env)?;
                    arms.push(format!(
                        "{bound} extends '{}' ? {target}",
                        bits32(case as i32)
                    ));
                }
                let default = self.jump(labels, targets.default(), env)?;
                let mut text = String::new();
                for arm in &arms {
                    text.push_str(&format!("{arm}\n  : "));
                }
                text.push_str(&default);
                Ok(Step::Terminate(text))
            }
            Return => {
                let text = self.emit_return(env)?;
                Ok(Step::Terminate(text))
            }
            Call { function_index } => {
                if *function_index < self.module.num_imports {
                    return Err(format!(
                        "calls to imported functions are not supported (function {function_index})"
                    ));
                }
                let defined = (function_index - self.module.num_imports) as usize;
                let type_index = *self
                    .module
                    .func_type_indices
                    .get(defined)
                    .ok_or_else(|| format!("no type for function {defined}"))?;
                let callee = self
                    .module
                    .func_types
                    .get(type_index as usize)
                    .ok_or_else(|| format!("no type {type_index}"))?;
                let num_params = callee.params().len();
                let num_results = callee.results().len();
                if num_results > 1 {
                    return Err("calls returning multiple values are not supported".to_string());
                }
                for param in callee.params() {
                    if *param != ValType::I32 {
                        return Err(format!("call takes a {param:?}, only i32 is supported"));
                    }
                }
                // arguments come off the stack in order
                let mut args = Vec::new();
                for _ in 0..num_params {
                    args.push(env.pop());
                }
                args.reverse();
                // the callee is the unmetered flavour: it runs to completion and
                // hands back ['r', memory, globals..., value?]
                let mut call_args = vec![env.memory.clone()];
                call_args.extend(env.globals.iter().cloned());
                call_args.extend(args);
                let call = format!("$call{defined}<{}>", call_args.join(", "));
                if let Some(value) = env.bind_result(&call, num_results > 0) {
                    env.push(value);
                }
                Ok(Step::Continue)
            }

            Unreachable => Ok(Step::Terminate("never".to_string())),

            other => Err(format!("unsupported operator: {other:?}")),
        }
    }

    /// Register the continuation that runs after a block/if ends.
    fn push_join(
        &mut self,
        join: usize,
        pos: usize,
        labels: &[Label],
        floor: usize,
        arity: usize,
    ) -> Result<(), String> {
        // the join takes the stack below the label plus the label's results
        let stack_params: Vec<String> = (0..floor + arity).map(|i| format!("$k{i}")).collect();
        self.pending.push(Pending {
            id: join,
            pos,
            labels: labels.to_vec(),
            stack: stack_params,
        });
        Ok(())
    }

    /// Upper bound on stores executed per iteration of the loop starting at `pos`.
    fn stores_until_end(&self, pos: usize) -> usize {
        let end = self.ends.get(&pos).map(|(e, _)| *e).unwrap_or(self.ops.len());
        let mut stores = 0;
        for op in &self.ops[pos..end.min(self.ops.len())] {
            if matches!(
                op,
                Operator::I32Store { .. }
                    | Operator::I32Store8 { .. }
                    | Operator::I32Store16 { .. }
                    | Operator::I64Store { .. }
            ) {
                stores += 1;
            }
        }
        stores
    }
}

enum Step {
    Continue,
    #[allow(dead_code)]
    Jump(usize),
    Terminate(String),
}

#[derive(Clone)]
struct BlockEnv {
    helpers: Rc<RefCell<BTreeMap<String, String>>>,
    memory: String,
    globals: Vec<String>,
    locals: Vec<String>,
    stack: Vec<String>,
    /// (name, constraint, expression) bindings, in order
    bindings: Vec<(String, String, String)>,
    /// locals read before this block writes them: what it needs passed in
    reads: BTreeSet<u32>,
    /// locals this block assigns
    writes: BTreeSet<u32>,
    /// expression text -> the name already bound to it, so a value computed
    /// twice in one block is computed once. Pong recomputes screen addresses
    /// constantly: erase and draw hit the same cells.
    computed: HashMap<String, String>,
    next_temp: usize,
    stores: usize,
}

impl BlockEnv {
    fn push(&mut self, value: String) {
        self.stack.push(value);
    }

    fn pop(&mut self) -> String {
        self.stack.pop().unwrap_or_else(|| format!("'{}'", zero()))
    }

    fn peek(&self) -> String {
        self.stack
            .last()
            .cloned()
            .unwrap_or_else(|| format!("'{}'", zero()))
    }

    fn local(&mut self, index: u32) -> Result<String, String> {
        if !self.writes.contains(&index) {
            self.reads.insert(index);
        }
        self.locals
            .get(index as usize)
            .cloned()
            .ok_or_else(|| format!("local {index} out of range"))
    }

    fn set_local(&mut self, index: u32, value: String) -> Result<(), String> {
        let index = index as usize;
        if index >= self.locals.len() {
            return Err(format!("local {index} out of range"));
        }
        let bound = self.bind(&value, "WasmValue");
        self.writes.insert(index as u32);
        self.locals[index] = bound;
        Ok(())
    }

    /// Name a computed value, so it is evaluated once, at its own depth, and
    /// referred to by name afterwards.
    fn bind(&mut self, expr: &str, constraint: &str) -> String {
        // literals, parameters and already-named values need no binding
        if !expr.contains('<') && !expr.contains(" extends ") {
            return expr.to_string();
        }
        if !SSA && expr.len() < 600 {
            return expr.to_string();
        }
        if let Some(existing) = self.computed.get(expr) {
            return existing.clone();
        }
        let name = format!("$t{}", self.next_temp);
        self.next_temp += 1;
        self.bindings
            .push((name.clone(), constraint.to_string(), expr.to_string()));
        self.computed.insert(expr.to_string(), name.clone());
        name
    }

    /// Bind a callee's `['r', memory, value?]` result: the caller's memory
    /// becomes the callee's, and the value (if any) lands on the stack.
    fn bind_result(&mut self, call: &str, has_value: bool) -> Option<String> {
        let memory_name = format!("$m{}", self.next_temp);
        self.next_temp += 1;
        let mut pattern = vec![
            "'r'".to_string(),
            format!("infer {memory_name} extends $Node"),
        ];
        let global_names: Vec<String> = (0..self.globals.len())
            .map(|_| {
                let name = format!("$g_{}", self.next_temp);
                self.next_temp += 1;
                name
            })
            .collect();
        for name in &global_names {
            pattern.push(format!("infer {name} extends WasmValue"));
        }
        let value_name = if has_value {
            let name = format!("$t{}", self.next_temp);
            self.next_temp += 1;
            pattern.push(format!("infer {name} extends WasmValue"));
            Some(name)
        } else {
            None
        };
        self.bindings
            .push((format!("[{}]", pattern.join(", ")), String::new(), call.to_string()));
        self.memory = memory_name;
        self.globals = global_names;
        value_name
    }

    fn binary(&mut self, op: &str, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        // both sides known: do it here rather than making the checker do it
        if let (Some(x), Some(y)) = (Self::literal(&a), Self::literal(&b)) {
            if let Some(folded) = fold(op, x, y) {
                self.push(format!("'{}'", bits32(folded as i32)));
                return ret;
            }
        }
        let value = format!("{op}<{a}, {b}>");
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    /// Is this value a literal we know at compile time?
    fn literal(value: &str) -> Option<u32> {
        let trimmed = value.trim();
        if trimmed.len() == 34 && trimmed.starts_with('\'') && trimmed.ends_with('\'') {
            u32::from_str_radix(&trimmed[1..33], 2).ok()
        } else {
            None
        }
    }

    fn register(&mut self, name: &str, definition: String) -> String {
        self.helpers
            .borrow_mut()
            .entry(name.to_string())
            .or_insert(definition);
        name.to_string()
    }

    /// shift left by a known amount: drop the top characters, append zeros
    fn shl_helper(&mut self, amount: u32) -> String {
        let name = format!("$Shl{amount}");
        let pattern: String = (0..32).map(|i| format!("${{infer c{i}}}")).collect();
        let kept: String = (amount..32).map(|i| format!("${{c{i}}}")).collect();
        let definition = format!(
            "export type {name}<A extends string> =\n  A extends `{pattern}`\n    ? `{kept}{zeros}`\n    : never\n",
            zeros = "0".repeat(amount as usize)
        );
        self.register(&name, definition)
    }

    /// shift right by a known amount, filling with zeros or with the sign
    fn shr_helper(&mut self, amount: u32, signed: bool) -> String {
        let name = format!("$Shr{}{}", if signed { "S" } else { "U" }, amount);
        let pattern: String = (0..32).map(|i| format!("${{infer c{i}}}")).collect();
        let fill: String = if signed {
            (0..amount).map(|_| "${c0}".to_string()).collect()
        } else {
            "0".repeat(amount as usize)
        };
        let kept: String = (0..32 - amount).map(|i| format!("${{c{i}}}")).collect();
        let definition = format!(
            "export type {name}<A extends string> =\n  A extends `{pattern}`\n    ? `{fill}{kept}`\n    : never\n"
        );
        self.register(&name, definition)
    }

    /// bitwise op against a known constant: one character choice per bit
    fn mask_helper(&mut self, op: &str, constant: u32) -> String {
        let name = format!("${op}{constant:08X}");
        let pattern: String = (0..32).map(|i| format!("${{infer c{i}}}")).collect();
        let result: String = (0..32)
            .map(|i| {
                let bit = (constant >> (31 - i)) & 1;
                match (op, bit) {
                    ("And", 0) => "0".to_string(),
                    ("And", _) => format!("${{c{i}}}"),
                    ("Or", 1) => "1".to_string(),
                    ("Or", _) => format!("${{c{i}}}"),
                    ("Xor", 1) => format!("${{$Flip[c{i}]}}"),
                    ("Xor", _) => format!("${{c{i}}}"),
                    _ => format!("${{c{i}}}"),
                }
            })
            .collect();
        let definition = format!(
            "export type {name}<A extends string> =\n  A extends `{pattern}`\n    ? `{result}`\n    : never\n"
        );
        self.register(&name, definition)
    }

    /// `a > b` is `b < a`
    fn binary_swapped(&mut self, op: &str, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        let value = format!("{op}<{b}, {a}>");
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    /// `a >= b` is `!(a < b)`
    fn binary_not(&mut self, op: &str, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        let value = format!("$Not1<{op}<{a}, {b}>>");
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    /// `a <= b` is `!(b < a)`
    fn binary_not_swapped(&mut self, op: &str, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        let value = format!("$Not1<{op}<{b}, {a}>>");
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    fn eqz(&mut self, ret: Result<Step, String>) -> Result<Step, String> {
        let a = self.pop();
        let value = format!("$Eq<{a}, '{}'>", zero());
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    /// A shift by a constant is a character move; only a variable amount needs
    /// the bit-recursive version.
    fn shift(&mut self, fallback: &str, kind: ShiftKind, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        let value = match Self::literal(&b).map(|amount| amount & 31) {
            Some(0) => a.clone(),
            Some(amount) => {
                let helper = match kind {
                    ShiftKind::Left => self.shl_helper(amount),
                    ShiftKind::RightUnsigned => self.shr_helper(amount, false),
                    ShiftKind::RightSigned => self.shr_helper(amount, true),
                };
                // cheap enough to leave inline: one conditional, no adder
                self.push(format!("{helper}<{a}>"));
                return ret;
            }
            None => format!("{fallback}<{a}, {b}>"),
        };
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    /// And/Or/Xor against a constant is one character choice per bit.
    ///
    /// Except for the bits an xor has to flip. A character inferred from a
    /// template pattern is typed `string`, which cannot index the flip table,
    /// and inferring it as `'0' | '1'` instead makes every position a union -
    /// 32 of those in one template literal is 2^32 combinations, which the
    /// checker refuses outright. ts-type-math walks the string one character at
    /// a time to stay clear of that, so xors with bits set go there.
    fn bitwise(&mut self, op: &str, fallback: &str, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        let flips = |constant: u32| op == "Xor" && constant != 0;
        let value = if let Some(constant) = Self::literal(&b).filter(|k| !flips(*k)) {
            let helper = self.mask_helper(op, constant);
            self.push(format!("{helper}<{a}>"));
            return ret;
        } else if let Some(constant) = Self::literal(&a).filter(|k| !flips(*k)) {
            let helper = self.mask_helper(op, constant);
            self.push(format!("{helper}<{b}>"));
            return ret;
        } else {
            format!("{fallback}<{a}, {b}>")
        };
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    /// Multiplying by a constant is a few shifts and adds; ts-type-math's long
    /// multiplication is only needed when both operands are unknown.
    fn multiply(&mut self, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        let (value, constant) = match (Self::literal(&a), Self::literal(&b)) {
            (Some(k), _) => (b.clone(), Some(k)),
            (_, Some(k)) => (a.clone(), Some(k)),
            _ => (String::new(), None),
        };
        let expression = match constant {
            Some(0) => format!("'{}'", zero()),
            Some(1) => value,
            Some(k) if k.count_ones() <= 2 && k < 0x8000_0000 => {
                // sum of shifted copies, low bits first
                let mut terms = Vec::new();
                for bit in 0..31 {
                    if (k >> bit) & 1 == 1 {
                        if bit == 0 {
                            terms.push(value.clone());
                        } else {
                            let helper = self.shl_helper(bit);
                            terms.push(format!("{helper}<{value}>"));
                        }
                    }
                }
                let mut sum = terms[0].clone();
                for term in &terms[1..] {
                    sum = format!("Wasm.I32Add<{sum}, {term}>");
                }
                sum
            }
            _ => format!("Wasm.I32Mul<{a}, {b}>"),
        };
        let named = self.bind(&expression, "WasmValue");
        self.push(named);
        ret
    }

    fn unary(&mut self, op: &str, ret: Result<Step, String>) -> Result<Step, String> {
        let a = self.pop();
        let value = format!("{op}<{a}>");
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    fn stores_ret(&self, ret: Result<Step, String>) -> Result<Step, String> {
        ret
    }

    fn address(&mut self, offset: u64) -> String {
        let base = self.pop();
        if offset == 0 {
            return base;
        }
        let sum = format!("Wasm.I32Add<{base}, '{}'>", bits32(offset as i32));
        self.bind(&sum, "WasmValue")
    }

    fn load(&mut self, helper: &str, offset: u64, ret: Result<Step, String>) -> Result<Step, String> {
        let addr = self.address(offset);
        let addr = self.bind(&addr, "WasmValue");
        let value = format!("{helper}<{}, {addr}>", self.memory);
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    fn store(&mut self, helper: &str, offset: u64, ret: Result<Step, String>) -> Result<Step, String> {
        let value = self.pop();
        let addr = self.address(offset);
        let addr = self.bind(&addr, "WasmValue");
        let value = self.bind(&value, "WasmValue");
        let next = format!("{helper}<{}, {addr}, {value}>", self.memory);
        // every store is named: keeps the emitted text flat and gives the fuel
        // accounting something to count
        let name = format!("$m{}", self.next_temp);
        self.next_temp += 1;
        self.bindings
            .push((name.clone(), "$Node".to_string(), next));
        self.memory = name;
        self.stores += 1;
        // loads read `self.memory`, so their text changes after a store anyway;
        // drop the cache entries that mention memory to be safe
        self.computed.retain(|expr, _| !expr.contains("$m"));
        self.stores_ret(ret)
    }
}

/// Constant folding for the operators the compiler emits. Same semantics as
/// wasm: wrapping arithmetic, comparisons yield 0 or 1.
fn fold(op: &str, a: u32, b: u32) -> Option<u32> {
    let sa = a as i32;
    let sb = b as i32;
    let value = match op {
        "Wasm.I32Add" => sa.wrapping_add(sb) as u32,
        "Wasm.I32Sub" => sa.wrapping_sub(sb) as u32,
        "Wasm.I32Mul" => sa.wrapping_mul(sb) as u32,
        "Wasm.I32And" => a & b,
        "Wasm.I32Or" => a | b,
        "Wasm.I32Xor" => a ^ b,
        "Wasm.I32Shl" => a.wrapping_shl(b & 31),
        "Wasm.I32ShrU" => a.wrapping_shr(b & 31),
        "Wasm.I32ShrS" => sa.wrapping_shr(b & 31) as u32,
        "Wasm.I32LtS" => (sa < sb) as u32,
        "Wasm.I32LtU" => (a < b) as u32,
        "Wasm.I32GtS" => (sa > sb) as u32,
        "Wasm.I32GtU" => (a > b) as u32,
        "Wasm.I32LeS" => (sa <= sb) as u32,
        "Wasm.I32LeU" => (a <= b) as u32,
        "Wasm.I32GeS" => (sa >= sb) as u32,
        "Wasm.I32GeU" => (a >= b) as u32,
        "$Eq" => (a == b) as u32,
        "$Ne" => (a != b) as u32,
        _ => return None,
    };
    Some(value)
}

enum ShiftKind {
    Left,
    RightUnsigned,
    RightSigned,
}

/// Replace every occurrence of a marker with a list, taking one of the
/// surrounding separators with it when the list is empty.
fn fill_marker(body: String, marker: &str, parts: &[String]) -> String {
    if !parts.is_empty() {
        return body.replace(marker, &parts.join(", "));
    }
    body.replace(&format!("{marker}, "), "")
        .replace(&format!(", {marker}"), "")
        .replace(marker, "")
}

/// fresh names for a block's incoming stack slots
fn fresh_stack(depth: usize) -> Vec<String> {
    (0..depth).map(|i| format!("$k{i}")).collect()
}

fn block_arity(blockty: &BlockType) -> Result<usize, String> {
    match blockty {
        BlockType::Empty => Ok(0),
        BlockType::Type(ValType::I32) => Ok(1),
        BlockType::Type(other) => Err(format!("block result type {other:?} is not supported")),
        BlockType::FuncType(_) => Err("multi-value block types are not supported".to_string()),
    }
}

fn indent(text: &str, spaces: usize) -> String {
    let pad = " ".repeat(spaces);
    text.replace('\n', &format!("\n{pad}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compile(path: &str) -> String {
        let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("could not read {path}: {e}"));
        CfgCompiler::new()
            .compile(&bytes)
            .unwrap_or_else(|e| panic!("{path} failed to compile: {e}"))
    }

    /// Every block must be able to stop. If any block lacks a fuel check, a long
    /// enough run has no way to hand control back and the evaluation dies with
    /// TS2589 instead of suspending.
    #[test]
    fn every_block_can_suspend() {
        let output = compile("packages/playground/pong-tiny/pong-tiny.wasm");
        let mut blocks = 0;
        for declaration in output.split("\nexport type $b").skip(1) {
            blocks += 1;
            let name = declaration.split('<').next().unwrap_or("?");
            assert!(
                declaration.contains("$F extends `1"),
                "block {name} never checks fuel"
            );
            assert!(
                declaration.contains("['s', '"),
                "block {name} has no suspend path"
            );
        }
        assert!(blocks > 50, "expected pong to compile to many blocks, got {blocks}");
    }

    /// A loop must be entered through its header and left through a *separate*
    /// exit block: sharing them makes `end` jump backwards and the loop never
    /// terminates.
    #[test]
    fn loops_have_a_distinct_exit() {
        let output = compile("packages/playground/cfg/store64.wasm");
        let entry = output
            .split("export type $run<")
            .nth(1)
            .expect("no entry type for the export");
        let header = entry
            .split("$b0_")
            .nth(1)
            .and_then(|rest| rest.split('<').next())
            .expect("entry does not tail-call a block");
        // the header branches to itself (back-edge) and to something else (exit)
        let body = output
            .split(&format!("export type $b0_{header}<"))
            .nth(1)
            .expect("header block missing");
        let targets: Vec<&str> = body
            .split("$b0_")
            .skip(1)
            .filter_map(|rest| rest.split('<').next())
            .collect();
        assert!(
            targets.iter().any(|t| *t != header),
            "loop header only ever jumps to itself: {targets:?}"
        );
    }

    /// Exported functions become entry types that take fuel and memory.
    #[test]
    fn exports_become_entry_types() {
        let output = compile("packages/playground/pong-tiny/pong-tiny.wasm");
        for export in ["frame", "score1", "score2"] {
            assert!(
                output.contains(&format!("export type ${export}<$F extends string, $M extends $Node")),
                "missing entry type for {export}"
            );
        }
    }

    /// Data segments are emitted as a concrete trie literal, sharing $Zero for
    /// everything untouched, so the first chunk starts from real memory.
    #[test]
    fn data_segments_become_a_trie_literal() {
        let output = compile("packages/playground/pong-tiny/pong-tiny.wasm");
        let literal = output
            .split("export type $InitialMemory = ")
            .nth(1)
            .and_then(|rest| rest.split('\n').next())
            .expect("no initial memory");
        assert!(literal.starts_with('['), "initial memory is not a tuple");
        assert!(literal.contains("$Zero"), "initial memory does not share zero subtrees");
        // pong's state block starts with initialised=0, ball_x=20, ball_y=12
        assert!(
            literal.contains(&format!("['{}']", format!("{:032b}", 20))),
            "expected ball_x=20 in the data segment"
        );
    }

    /// i64 and floats are not supported yet; the compiler must say so rather
    /// than emit something that quietly disagrees with the engine.
    #[test]
    fn unsupported_types_are_rejected() {
        let bytes = std::fs::read("packages/conformance-tests/from-wat/single-i64add.wasm");
        if let Ok(bytes) = bytes {
            let error = CfgCompiler::new().compile(&bytes).unwrap_err();
            assert!(
                error.contains("i64") || error.contains("I64"),
                "expected an i64 complaint, got {error}"
            );
        }
    }
}
