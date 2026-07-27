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
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
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
    /// (name, constraint, expression) per instruction, in order
    bindings: Vec<(String, String, String)>,
    /// what the block does once its instructions have run
    terminator: String,
    /// incoming stack slots, as parameter names
    stack: Vec<String>,
    /// a binding destructures a pattern, so this block cannot be a pipeline
    has_pattern: bool,
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

/// Rewrite the fuel variable in a block body, leaving names that merely start
/// with `$F` (like `$Flush`) alone.
fn rename_fuel(text: &str) -> String {
    let bytes: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == '$' && i + 1 < bytes.len() && bytes[i + 1] == 'F' {
            let next = bytes.get(i + 2).copied();
            let continues = next.map(|c| c.is_alphanumeric() || c == '_').unwrap_or(false);
            if !continues {
                out.push_str("$F1");
                i += 2;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    out
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
        let node_pattern_names: String = (0..fanout)
            .map(|i| format!("c{i}"))
            .collect::<Vec<_>>()
            .join(", ");

        // the write buffer holds one bottom branch: the key is every digit above
        // it, so a store that stays inside the branch is a slot swap
        let key_bits = bits - digit;
        let buf_key: String = (0..key_bits).map(|i| format!("${{b{i}}}")).collect();
        let buf_digits: String = (0..levels - 1)
            .map(|l| {
                let group: String = (0..digit).map(|d| format!("${{b{}}}", l * digit + d)).collect();
                format!("`{group}`")
            })
            .collect::<Vec<_>>()
            .join(", ");
        let last_digit: String = (key_bits..bits).map(|i| format!("${{b{i}}}")).collect();
        let empty_slots: String = (0..fanout).map(|_| "'x'").collect::<Vec<_>>().join(", ");
        let merge_slots: String = (0..fanout)
            .map(|i| format!("S[{i}] extends 'x' ? N[{i}] : S[{i}]"))
            .collect::<Vec<_>>()
            .join(", ");
        // a key no real address can have, meaning "buffer empty"
        let buf_none = "e".repeat(key_bits.max(1));

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

/// The state a block's instruction pipeline threads through: memory in slot 0,
/// then one slot per value. Typing it this way means a step can read `$S[3]` and
/// get a `WasmValue` back with no narrowing at the read.
export type $State = [$Node, ...WasmValue[]]

/// everything but the memory slot, so a store can put a new memory in its place
export type $Rest<$S extends $State> =
  $S extends [unknown, ...infer $R extends WasmValue[]] ? $R : never
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

/// A branch node, expanding a shared leaf into {fanout} copies of itself.
export type $Node8<T> = T extends [{node_pattern}]
  ? [{node_pattern_names}] : [{all_same}]

/// The address split the way the write buffer wants it: the key of the bottom
/// branch (everything but the last digit), that key as digits, and the digit.
export type $Split<A extends string> =
  A extends `{high}{mid}${{infer _l0}}${{infer _l1}}`
    ? [`{buf_key}`, [{buf_digits}], `{last_digit}`]
    : never

/// One slot per word of the bottom branch; 'x' means "not written yet", which
/// is what lets a flush leave untouched words alone without reading them first.
export type $Empty = [{empty_slots}]

/// Push the buffered slots into the trie: one walk down, one merge at the leaf.
export type $MergeAt<T, B extends unknown[], S extends unknown[]> =
  B extends [infer D extends string, ...infer Rest]
    ? $Set<$Node8<T>, D, $MergeAt<$Sel<$Node8<T>, D>, Rest, S>>
    : $Node8<T> extends infer N extends unknown[]
      ? [{merge_slots}]
      : never

/// Memory as the host sees it: a plain trie, with nothing pending.
export type $Flush<M> = M extends [infer T, infer K, infer B extends unknown[], infer S extends unknown[]]
  ? K extends '{buf_none}' ? T : $MergeAt<T, B, S>
  : M
export type $Buf<T> = [T, '{buf_none}', [], $Empty]

/// Stores go into a one-branch write buffer instead of straight into the trie.
/// Measured on a real frame: consecutive words - which is what pixel loops and
/// memsets write - then share a single walk down the trie instead of paying
/// {levels} rebuild levels each, and a scattered store costs what it did before.
export type $Read<M extends $Node, A extends WasmValue> =
  M extends [infer T, infer MK extends string, unknown[], infer S extends unknown[]]
    ? $Slice<A> extends infer P extends string
      ? P extends `${{MK}}${{infer D}}`
        ? $Sel<S, D> extends infer H
          ? H extends 'x' ? $Get<T, P> : $Word<H>
          : never
        : $Get<T, P>
      : never
    : never
export type $Write<M extends $Node, A extends WasmValue, V extends WasmValue> =
  $Split<A> extends [infer K extends string, infer B extends unknown[], infer D extends string]
    ? M extends [infer T, infer MK, infer MB extends unknown[], infer S extends unknown[]]
      ? K extends MK
        ? [T, MK, MB, $Set<S, D, [V]>]
        : [(MK extends '{buf_none}' ? T : $MergeAt<T, MB, S>), K, B, $Set<$Empty, D, [V]>]
      : never
    : never

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
            node_pattern_names = node_pattern_names,
            buf_key = buf_key,
            buf_digits = buf_digits,
            last_digit = last_digit,
            empty_slots = empty_slots,
            merge_slots = merge_slots,
            buf_none = buf_none,
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
        let mut args: Vec<String> = vec!["$F".to_string(), "$Buf<$M>".to_string()];
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
        self.render_blocks();
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

    /// Render every block now that liveness is settled: the markers left during
    /// compilation can be filled in, and a pipeline's slot indices are known.
    fn render_blocks(&mut self) {
        let live: HashMap<usize, Vec<u32>> = self
            .blocks
            .iter()
            .map(|block| (block.id, block.live.iter().copied().collect()))
            .collect();
        let sites = std::mem::take(&mut self.sites);
        let blocks = std::mem::take(&mut self.blocks);
        let mut rendered = Vec::with_capacity(blocks.len());
        for mut block in blocks {
            // the locals passed at each jump have to be filled in before the
            // block is rendered: a pipeline rewrites value names to slot reads,
            // and names that arrive later would be left dangling
            block.terminator = self.resolve_jumps(std::mem::take(&mut block.terminator), &live, &sites);
            // a pipeline needs at least a couple of instructions to be worth the
            // aliases, and cannot express a destructuring binding
            let destructures = block
                .bindings
                .iter()
                .any(|(name, _, _)| name.contains("infer") || name.starts_with('['));
            // Nested `infer`s are the cheaper rendering while a block is short:
            // measured on gfx, 16.8 frames a second nested against 10.4 as a
            // pipeline, because appending to the state tuple costs more per
            // instruction than one more `infer`. Past the crossover the nesting
            // is what costs - 16 deep is 10.4s in the worst shape, 20 is 13.7
            // minutes - so long blocks get the pipeline, whose cost is linear.
            let body = if block.has_pattern || destructures || block.bindings.len() <= Self::NEST_LIMIT {
                self.render_nested(&block)
            } else {
                self.render_pipeline(&block, &live)
            };
            block.body = self.resolve_markers(body, &block, &live);
            rendered.push(block);
        }
        self.blocks = rendered;
        self.sites = sites;
    }

    /// Fill in the locals passed at each jump: which of the values in scope the
    /// target block turned out to want.
    fn resolve_jumps(
        &self,
        mut body: String,
        live: &HashMap<usize, Vec<u32>>,
        sites: &[(usize, Vec<String>)],
    ) -> String {
        let empty = Vec::new();
        while let Some(start) = body.find("\u{1}L") {
            let end = body[start + 2..]
                .find('\u{1}')
                .map(|at| start + 2 + at)
                .unwrap_or(body.len());
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
        body
    }

    /// Fill in this block's parameter list and its suspend payload.
    fn resolve_markers(
        &self,
        body: String,
        block: &EmittedBlock,
        live: &HashMap<usize, Vec<u32>>,
    ) -> String {
        let empty = Vec::new();
        let wanted = live.get(&block.id).unwrap_or(&empty);
        let params: Vec<String> = wanted
            .iter()
            .map(|index| format!("$l{index} extends WasmValue"))
            .collect();
        let payload: Vec<String> = wanted.iter().map(|index| format!("$l{index}")).collect();
        let mut body = fill_marker(body, &format!("\u{1}P{}\u{1}", block.id), &params);
        body = fill_marker(body, &format!("\u{1}S{}\u{1}", block.id), &payload);
        body
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

    /// Blocks up to this many instructions are rendered as nested `infer`s,
    /// longer ones as a pipeline.
    const NEST_LIMIT: usize = 10;

    /// The same limit for a block rendered as a pipeline, where instructions are
    /// applications of one-step aliases rather than nested `infer`s and the
    /// checker's cost is linear instead of exponential. This is only here to
    /// keep the state tuple and the generated text a sane size.

    /// Memory operations inside a block chain: each store leaves the memory as
    /// an unevaluated `$Store32<...>` wrapped around the last one, and every
    /// later load has to walk through them. Long arithmetic runs stay cheap,
    /// long runs of loads and stores do not, so they get their own limit.

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
            has_pattern: false,
            mem_ops: 0,
            reads: BTreeSet::new(),
            writes: BTreeSet::new(),
            computed: HashMap::new(),
            shallow: HashSet::new(),
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
            // A block that touches memory stays short: inside a block the
            // memory is an unevaluated `$Store32<$Store32<...>>` chain that
            // every later load walks, and that cost is not linear. A run of
            // pure arithmetic has no such chain, so it is allowed to grow and
            // is rendered as a pipeline instead of nested `infer`s.
            let cap = if env.has_pattern || env.mem_ops > 0 {
                Self::DEPTH_CAP
            } else {
                pipeline_cap()
            };
            if env.bindings.len() >= cap {
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
        Ok(EmittedBlock {
            id: pending.id,
            stack_arity: pending.stack.len(),
            // rendered after liveness: the state layout depends on which locals
            // survive, and the step aliases index into it by position
            body: String::new(),
            cost,
            reads: env.reads.clone(),
            writes: env.writes.clone(),
            successors: std::mem::take(&mut self.successors),
            live: BTreeSet::new(),
            bindings: env.bindings.clone(),
            terminator,
            stack: pending.stack.clone(),
            has_pattern: env.has_pattern,
        })
    }

    /// Wrap the block's terminator in its bindings, fuel check and parameters.
    /// The parameters every block declares, before its own stack slots.
    fn block_params(&self, block: &EmittedBlock) -> Vec<String> {
        let mut params = if self.metered {
            vec!["$F extends string".to_string(), "$M extends $Node".to_string()]
        } else {
            vec!["$M extends $Node".to_string()]
        };
        for i in 0..self.module.globals.len() {
            params.push(format!("$g{i} extends WasmValue"));
        }
        params.push(format!("\u{1}P{}\u{1}", block.id));
        for name in &block.stack {
            params.push(format!("{name} extends WasmValue"));
        }
        params
    }

    /// Wrap a block's work in its fuel check, or emit it bare when the function
    /// is only ever called from another one and runs to completion.
    fn wrap_block(&self, block: &EmittedBlock, inner: &str) -> String {
        let params = self.block_params(block);
        let body = if !self.metered {
            format!("  {}", indent(inner, 2))
        } else {
            // out of fuel: hand the block id and everything live back to the host
            // the host only ever sees flushed memory, so a snapshot round-trips
            // through text exactly as it did before the buffer existed
            let mut alive = vec!["$Flush<$M>".to_string()];
            for i in 0..self.module.globals.len() {
                alive.push(format!("$g{i}"));
            }
            alive.push(format!("\u{1}S{}\u{1}", block.id));
            alive.extend(block.stack.iter().cloned());
            let burn: String = std::iter::repeat('1').take(block.cost).collect();
            format!(
                "  $F extends `{burn}${{infer $F1}}`\n  ? {}\n  : ['s', '{}_{}', {}]",
                indent(&rename_fuel(inner), 2),
                self.func_index,
                block.id,
                alive.join(", ")
            )
        };
        format!(
            "\nexport type {}<{}> =\n{}\n",
            self.block_name(block.id),
            params.join(", "),
            body
        )
    }

    /// One `infer` per instruction, nested. Kept for blocks that destructure a
    /// call result, and for blocks too short to be worth a pipeline.
    fn render_nested(&self, block: &EmittedBlock) -> String {
        let mut inner = String::new();
        for (name, constraint, expr) in &block.bindings {
            // most bindings name one value; a call binds a whole result pattern
            if constraint.is_empty() {
                inner.push_str(&format!("{expr} extends {name}\n  ? "));
            } else {
                inner.push_str(&format!("{expr} extends infer {name} extends {constraint}\n  ? "));
            }
        }
        inner.push_str(&block.terminator);
        for _ in &block.bindings {
            inner.push_str("\n  : never");
        }
        self.wrap_block(block, &inner)
    }

    /// Instructions as a pipeline: each one is an alias that appends its result
    /// to a state tuple, and the block applies them in turn.
    ///
    ///   type $p0_3_0<$S extends unknown[]> = [...$S, Wasm.I32Add<$S[3] & WasmValue, '..'>]
    ///   $p0_3_1<$p0_3_0<[$M, $l0, $s0]>> extends infer $S extends unknown[] ? ...
    ///
    /// Nesting `infer`s costs the checker time exponential in the depth of the
    /// chain - 16 deep is 19ms, 24 is 3.2s, 32 does not finish. Applying aliases
    /// instead is linear: 128 in a row is 17ms. That is the whole reason this
    /// exists, and it is why a block no longer has to be short.
    fn render_pipeline(&self, block: &EmittedBlock, live: &HashMap<usize, Vec<u32>>) -> String {
        // memory lives in slot 0 for the whole block and a store replaces it in
        // place; every other value is appended as it is computed. Because the
        // state is typed `[$Node, ...WasmValue[]]`, a read is just `$S[3]`.
        let mut slots: HashMap<String, usize> = HashMap::new();
        let mut initial: Vec<String> = vec!["$M".to_string()];
        slots.insert("$M".to_string(), 0);
        for i in 0..self.module.globals.len() {
            slots.insert(format!("$g{i}"), initial.len());
            initial.push(format!("$g{i}"));
        }
        let empty = Vec::new();
        for index in live.get(&block.id).unwrap_or(&empty) {
            slots.insert(format!("$l{index}"), initial.len());
            initial.push(format!("$l{index}"));
        }
        for name in &block.stack {
            slots.insert(name.clone(), initial.len());
            initial.push(name.clone());
        }

        let mut steps = String::new();
        let mut applied = format!("[{}]", initial.join(", "));
        let mut width = initial.len();
        for (position, (name, constraint, expr)) in block.bindings.iter().enumerate() {
            let step = format!("$p{}_{}_{}", self.func_index, block.id, position);
            let rewritten = state_reads(expr, &slots);
            let body = if constraint == "$Node" {
                // a store: the new memory takes slot 0, the values are untouched
                slots.insert(name.clone(), 0);
                format!("[{rewritten}, ...$Rest<$S>]")
            } else {
                slots.insert(name.clone(), width);
                width += 1;
                format!("[...$S, {rewritten}]")
            };
            steps.push_str(&format!(
                "\nexport type {step}<$S extends $State> =\n  {body}\n"
            ));
            applied = format!("{step}<{applied}>");
        }

        let terminator = state_reads(&block.terminator, &slots);
        let inner = format!(
            "{applied} extends infer $S extends $State\n  ? {}\n  : never",
            indent(&terminator, 2)
        );
        format!("{steps}{}", self.wrap_block(block, &inner))
    }

    /// Return from the function: memory, then globals if a callee has to hand
    /// them back, then the result.
    fn emit_return(&self, env: &mut BlockEnv) -> Result<String, String> {
        let mut parts = vec![
            "'r'".to_string(),
            if self.metered {
                format!("$Flush<{}>", env.memory)
            } else {
                env.memory.clone()
            },
        ];
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
            I32Add => env.add_or_sub("Wasm.I32Add", false, Ok(Step::Continue)),
            I32Sub => env.add_or_sub("Wasm.I32Sub", true, Ok(Step::Continue)),
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
            I32LtS => env.compare("Wasm.I32LtS", Compare::Lt, true, Ok(Step::Continue)),
            I32LtU => env.compare("Wasm.I32LtU", Compare::Lt, false, Ok(Step::Continue)),
            I32GtS => env.compare("Wasm.I32GtS", Compare::Gt, true, Ok(Step::Continue)),
            I32GtU => env.compare("Wasm.I32GtU", Compare::Gt, false, Ok(Step::Continue)),
            I32LeS => env.compare("Wasm.I32LeS", Compare::Le, true, Ok(Step::Continue)),
            I32LeU => env.compare("Wasm.I32LeU", Compare::Le, false, Ok(Step::Continue)),
            I32GeS => env.compare("Wasm.I32GeS", Compare::Ge, true, Ok(Step::Continue)),
            I32GeU => env.compare("Wasm.I32GeU", Compare::Ge, false, Ok(Step::Continue)),
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
    /// loads and stores so far: memory operations chain, so a block that does
    /// too many of them is split even when it is short
    mem_ops: usize,
    /// set when a binding destructures a pattern rather than naming one value;
    /// those blocks keep the older nested rendering
    has_pattern: bool,
    /// locals read before this block writes them: what it needs passed in
    reads: BTreeSet<u32>,
    /// locals this block assigns
    writes: BTreeSet<u32>,
    /// expression text -> the name already bound to it, so a value computed
    /// twice in one block is computed once. Pong recomputes screen addresses
    /// constantly: erase and draw hit the same cells.
    computed: HashMap<String, String>,
    /// Expressions built only from the specialised helpers: a pattern match or
    /// two deep, so they can be nested into whatever consumes them instead of
    /// taking a pipeline slot of their own. SSA exists to keep ts-type-math's
    /// ~32-level operators off one another, and these are not that.
    shallow: HashSet<String>,
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
        // a shallow helper chain costs less inline than the pipeline step that
        // would hold it; the length cap keeps a block's text from exploding
        if self.shallow.contains(expr) && expr.len() < 400 {
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
        if constraint.is_empty() {
            self.has_pattern = true;
        }
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

    /// Add or subtract 2^k without an adder.
    ///
    /// Incrementing a binary string is "flip the run of 1s at the bottom and
    /// the 0 that stops it", which template patterns can do directly:
    /// `${infer H}011` -> `${H}100`. The arms are mutually exclusive because
    /// each anchors a different suffix, and the first one matches for half of
    /// all values.
    ///
    /// Two things this must not do. The carry cannot be found with a pattern
    /// like `${infer H}0${infer l0}${infer l1}` that leaves the low bits as
    /// trailing placeholders - inference binds H at the *first* '0' in the
    /// string, not the one the bit position asks for. And the run cannot be
    /// walked by testing characters, because a character inferred from a
    /// template is typed `string`, so `c extends '1'` is never true. So the low
    /// bits are split off by width first, and the rest is incremented as a
    /// shorter string of its own.
    fn carry_helper(&mut self, width: usize, down: bool) -> String {
        let name = format!("${}Top{width}", if down { "Dec" } else { "Inc" });
        let (stop, run, new_stop, new_run) = if down { ('1', '0', '0', '1') } else { ('0', '1', '1', '0') };
        let mut arms = Vec::new();
        for m in 0..width {
            let run_chars: String = std::iter::repeat(run).take(m).collect();
            let new_run_chars: String = std::iter::repeat(new_run).take(m).collect();
            arms.push(format!(
                "  A extends `${{infer H}}{stop}{run_chars}` ? `${{H}}{new_stop}{new_run_chars}`"
            ));
        }
        // every character was part of the run: the value wrapped
        let wrapped: String = std::iter::repeat(new_run).take(width).collect();
        let definition = format!(
            "export type {name}<A extends string> =\n{}\n  : '{wrapped}'\n",
            arms.join(" :\n")
        );
        self.register(&name, definition)
    }

    fn step_helper(&mut self, bit: u32, down: bool) -> String {
        let name = format!("${}{bit}", if down { "Dec" } else { "Inc" });
        let width = 32 - bit as usize;
        if bit == 0 {
            let top = self.carry_helper(width, down);
            let definition = format!("export type {name}<A extends string> = {top}<A>\n");
            return self.register(&name, definition);
        }
        let (stop, run, new_stop, new_run) = if down { ('1', '0', '0', '1') } else { ('0', '1', '1', '0') };
        // Up to three low bits are cheaper to spell out than to split off: the
        // arms stay anchored at the end, so inference cannot slide the carry to
        // the wrong position, and an aligned address matches the first arm.
        // Wider than that the arm count doubles per bit, so the low bits come
        // off by width instead and the carry runs on the shorter string.
        let definition = if bit <= 3 {
            let mut arms = Vec::new();
            for m in 0..width {
                let run_chars: String = std::iter::repeat(run).take(m).collect();
                let new_run_chars: String = std::iter::repeat(new_run).take(m).collect();
                for low in 0..(1u32 << bit) {
                    let low_chars: String = (0..bit).rev().map(|i| if (low >> i) & 1 == 1 { '1' } else { '0' }).collect();
                    arms.push(format!(
                        "  A extends `${{infer H}}{stop}{run_chars}{low_chars}` ? `${{H}}{new_stop}{new_run_chars}{low_chars}`"
                    ));
                }
            }
            let wrapped_high: String = std::iter::repeat(new_run).take(width).collect();
            format!(
                "export type {name}<A extends string> =\n{}\n  : `{wrapped_high}${{$Low{bit}<A>}}`\n",
                arms.join(" :\n")
            )
        } else {
            let top = self.carry_helper(width, down);
            let pattern: String = (0..width).map(|i| format!("${{infer c{i}}}")).collect();
            let high: String = (0..width).map(|i| format!("${{c{i}}}")).collect();
            format!(
                "export type {name}<A extends string> =\n  A extends `{pattern}${{infer L}}`\n    ? `${{{top}<`{high}`>}}${{L}}`\n    : never\n"
            )
        };
        if bit <= 3 {
            // only reached when the value wraps, so it can afford to be plain
            let low_name = format!("$Low{bit}");
            let pattern: String = (0..(32 - bit)).map(|i| format!("${{infer c{i}}}")).collect();
            let low_definition = format!(
                "export type {low_name}<A extends string> = A extends `{pattern}${{infer L}}` ? L : never\n"
            );
            self.register(&low_name, low_definition);
        }
        self.register(&name, definition)
    }

    /// A constant addend as a short list of +/- powers of two (non-adjacent
    /// form), so `+31` is one step up and one step down rather than five
    /// carries. Returns None when the constant would need too many steps to be
    /// worth it and the general adder is cheaper.
    fn steps_for(constant: u32, limit: u32) -> Option<Vec<(u32, bool)>> {
        let mut steps = Vec::new();
        let mut value = constant;
        let mut bit = 0u32;
        while value != 0 {
            if bit >= 32 {
                // the carry ran off the top: it wrapped, which costs nothing
                break;
            }
            if value & 1 == 1 {
                let down = value & 2 == 2;
                if down {
                    value = value.wrapping_add(1);
                    steps.push((bit, true));
                } else {
                    steps.push((bit, false));
                    value &= !1;
                }
            }
            value >>= 1;
            bit += 1;
            if steps.len() as u32 > limit {
                return None;
            }
        }
        if steps.is_empty() { None } else { Some(steps) }
    }

    /// `x + c` for a known c: a few bit steps instead of a 32-bit adder.
    /// Measured on gfx's own values: 13 instantiations against 245.
    fn add_or_sub(&mut self, op: &str, negate: bool, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        if let (Some(x), Some(y)) = (Self::literal(&a), Self::literal(&b)) {
            if let Some(folded) = fold(op, x, y) {
                self.push(format!("'{}'", bits32(folded as i32)));
                return ret;
            }
        }
        // only the right side can be constant-folded this way for a subtract:
        // `c - x` is not `x - c`
        let constant = Self::literal(&b).map(|k| if negate { 0u32.wrapping_sub(k) } else { k });
        let variable = a.clone();
        let plain = Self::literal(&a)
            .filter(|_| !negate)
            .map(|k| (k, b.clone()));
        let (constant, variable) = match (constant, plain) {
            (Some(k), _) => (Some(k), variable),
            (None, Some((k, other))) => (Some(k), other),
            _ => (None, variable),
        };
        if let Some(constant) = constant {
            if let Some(steps) = Self::steps_for(constant, 4) {
                let mut value = variable;
                for (bit, down) in steps {
                    let helper = self.step_helper(bit, down);
                    value = format!("{helper}<{value}>");
                    self.shallow.insert(value.clone());
                }
                self.push(value);
                return ret;
            }
        }
        let value = format!("{op}<{a}, {b}>");
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
    }

    /// `x < C` for a known C: the answer is decided by a prefix. Wherever C has
    /// a 1 and x has a 0 with the bits above matching, x is smaller - so the
    /// test is a handful of anchored patterns, one per set bit, instead of a
    /// bit-by-bit comparison. Measured: 16 instantiations against 491.
    ///
    /// Signed compares are the same question about `x ^ 0x80000000`, which only
    /// changes the first character of every pattern.
    fn less_helper(&mut self, constant: u32, signed: bool) -> String {
        let mapped = if signed { constant ^ 0x8000_0000 } else { constant };
        let name = format!("$Lt{}{:08X}", if signed { "S" } else { "U" }, constant);
        let bits: Vec<char> = format!("{mapped:032b}").chars().collect();
        let mut arms = Vec::new();
        for i in 0..32 {
            if bits[i] != '1' {
                continue;
            }
            let mut prefix: String = bits[..i].iter().collect();
            prefix.push('0');
            if signed {
                // the pattern is about x ^ 0x80000000, so the sign character flips
                let mut chars: Vec<char> = prefix.chars().collect();
                chars[0] = if chars[0] == '0' { '1' } else { '0' };
                prefix = chars.into_iter().collect();
            }
            arms.push(format!("  A extends `{prefix}${{infer _r}}` ? '{}'", bits32(1)));
        }
        let definition = if arms.is_empty() {
            // nothing is below the smallest value
            format!("export type {name}<A extends string> = '{}'\n", zero())
        } else {
            format!(
                "export type {name}<A extends string> =\n{}\n  : '{}'\n",
                arms.join(" :\n"),
                zero()
            )
        };
        self.register(&name, definition)
    }

    /// A comparison against a constant, in whichever form the program wrote it.
    fn compare(
        &mut self,
        fallback: &str,
        kind: Compare,
        signed: bool,
        ret: Result<Step, String>,
    ) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        if let (Some(x), Some(y)) = (Self::literal(&a), Self::literal(&b)) {
            if let Some(folded) = fold(fallback, x, y) {
                self.push(format!("'{}'", bits32(folded as i32)));
                return ret;
            }
        }
        // `a OP b` with one side constant becomes `variable < constant`,
        // possibly negated: x > c is not (x < c+1), x >= c is not (x < c)
        let plan = match (Self::literal(&b), Self::literal(&a)) {
            (Some(c), _) => Some((a.clone(), c, kind)),
            (None, Some(c)) => Some((b.clone(), c, kind.flipped())),
            _ => None,
        };
        if let Some((variable, constant, kind)) = plan {
            if let Some((bound, negate)) = kind.as_less_than(constant, signed) {
                let helper = self.less_helper(bound, signed);
                let value = format!("{helper}<{variable}>");
                let value = if negate { format!("$Not1<{value}>") } else { value };
                self.shallow.insert(value.clone());
                self.push(value);
                return ret;
            }
            // the bound ran off the end of the range: the answer is a constant
            if let Some(answer) = kind.saturated(constant, signed) {
                self.push(format!("'{}'", if answer { bits32(1) } else { zero() }));
                return ret;
            }
        }
        let value = format!("{fallback}<{a}, {b}>");
        let named = self.bind(&value, "WasmValue");
        self.push(named);
        ret
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
                let value = format!("{helper}<{a}>");
                self.shallow.insert(value.clone());
                self.push(value);
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
            let value = format!("{helper}<{a}>");
            self.shallow.insert(value.clone());
            self.push(value);
            return ret;
        } else if let Some(constant) = Self::literal(&a).filter(|k| !flips(*k)) {
            let helper = self.mask_helper(op, constant);
            let value = format!("{helper}<{b}>");
            self.shallow.insert(value.clone());
            self.push(value);
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

    /// `base + static offset` is the most common add in any compiled program -
    /// every load and store has one - so it takes the same bit-step helpers as
    /// an ordinary constant add rather than a full adder.
    fn address(&mut self, offset: u64) -> String {
        let base = self.pop();
        if offset == 0 {
            return base;
        }
        let constant = offset as u32;
        if let Some(folded) = Self::literal(&base).map(|k| k.wrapping_add(constant)) {
            return format!("'{}'", bits32(folded as i32));
        }
        if let Some(steps) = Self::steps_for(constant, 4) {
            let mut value = base;
            for (bit, down) in steps {
                let helper = self.step_helper(bit, down);
                value = format!("{helper}<{value}>");
                self.shallow.insert(value.clone());
            }
            return value;
        }
        let sum = format!("Wasm.I32Add<{base}, '{}'>", bits32(offset as i32));
        self.bind(&sum, "WasmValue")
    }

    fn load(&mut self, helper: &str, offset: u64, ret: Result<Step, String>) -> Result<Step, String> {
        self.mem_ops += 1;
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
        self.mem_ops += 1;
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

/// Rewrite value names to reads of the state tuple: `$t7` becomes `$S[5]`.
///
/// Names not in the map - the fuel `$F`, helper aliases like `$Store32`, the
/// block's own `$S` - are left exactly as they are.
fn state_reads(text: &str, slots: &HashMap<String, usize>) -> String {
    let mut out = String::with_capacity(text.len());
    let bytes: Vec<char> = text.chars().collect();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] != '$' {
            out.push(bytes[at]);
            at += 1;
            continue;
        }
        let mut end = at + 1;
        while end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == '_') {
            end += 1;
        }
        let name: String = bytes[at..end].iter().collect();
        match slots.get(&name) {
            Some(slot) => out.push_str(&format!("$S[{slot}]")),
            None => out.push_str(&name),
        }
        at = end;
    }
    out
}

/// tunable while the two limits are being measured
/// How many instructions a pipelined block may hold. Only a sanity bound on the
/// size of the generated text: the checker's cost in the length of a pipeline is
/// linear, measured flat out to 128 steps.
fn pipeline_cap() -> usize {
    std::env::var("PIPELINE_CAP")
        .ok()
        .and_then(|text| text.parse().ok())
        .unwrap_or(64)
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

/// Which way a comparison points, so a constant operand can be turned into the
/// one form there is a helper for: `variable < bound`.
#[derive(Clone, Copy, PartialEq)]
enum Compare {
    Lt,
    Le,
    Gt,
    Ge,
}

impl Compare {
    /// the same question asked from the other side, for `constant OP variable`
    fn flipped(self) -> Self {
        match self {
            Compare::Lt => Compare::Gt,
            Compare::Gt => Compare::Lt,
            Compare::Le => Compare::Ge,
            Compare::Ge => Compare::Le,
        }
    }

    /// `(bound, negated)` for `variable < bound`, or None when the bound would
    /// have to be one past the end of the range
    fn as_less_than(self, constant: u32, signed: bool) -> Option<(u32, bool)> {
        let highest = if signed { 0x7fff_ffffu32 } else { 0xffff_ffff };
        match self {
            Compare::Lt => Some((constant, false)),
            Compare::Ge => Some((constant, true)),
            Compare::Le | Compare::Gt => {
                if constant == highest {
                    None
                } else {
                    Some((constant.wrapping_add(1), self == Compare::Gt))
                }
            }
        }
    }

    /// the answer when the bound is out of range: nothing is above the largest
    /// value, and everything is at or below it
    fn saturated(self, constant: u32, signed: bool) -> Option<bool> {
        let highest = if signed { 0x7fff_ffffu32 } else { 0xffff_ffff };
        if constant != highest {
            return None;
        }
        match self {
            Compare::Gt => Some(false),
            Compare::Le => Some(true),
            _ => None,
        }
    }
}
