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

use std::collections::HashMap;
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
}

impl CfgCompiler {
    pub fn new() -> Self {
        Self {
            bits_override: None,
            digit_bits: 3,
            func_types: Vec::new(),
            func_type_indices: Vec::new(),
            data: Vec::new(),
            globals: Vec::new(),
            memory_pages: 1,
            exports: Vec::new(),
            num_imports: 0,
            trie_bits: 14,
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

        // compile every exported function (pong-tiny exports frame/score1/score2)
        let mut entries = Vec::new();
        for (name, export_index) in self.exports.clone() {
            if export_index < self.num_imports {
                continue;
            }
            let defined = (export_index - self.num_imports) as usize;
            let body = bodies
                .get(defined)
                .ok_or_else(|| format!("export {name} points at a missing function body"))?;
            let type_index = *self
                .func_type_indices
                .get(defined)
                .ok_or_else(|| format!("no type for function {defined}"))?;
            let func_type = self
                .func_types
                .get(type_index as usize)
                .ok_or_else(|| format!("no type {type_index}"))?
                .clone();
            let (blocks, num_locals) = self.compile_function(defined, body, &func_type)?;
            for block in &blocks {
                out.push_str(&block.body);
                out.push('\n');
            }
            entries.push(self.emit_entry(&name, defined, &func_type, num_locals, &blocks));
        }
        for entry in entries {
            out.push_str(&entry);
        }
        Ok(out)
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
            ops: &ops,
            num_locals,
            num_results,
            blocks: Vec::new(),
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
        for i in 0..num_locals {
            args.push(if i < num_params {
                params[i].clone()
            } else {
                format!("'{}'", zero())
            });
        }
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
    ops: &'a [Operator<'a>],
    num_locals: usize,
    num_results: usize,
    blocks: Vec<EmittedBlock>,
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
        format!("$b{}_{}", self.func_index, id)
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
        Ok(())
    }

    fn compile_block(&mut self, pending: Pending) -> Result<EmittedBlock, String> {
        let mut env = BlockEnv {
            memory: "$M".to_string(),
            globals: (0..self.module.globals.len())
                .map(|i| format!("$g{i}"))
                .collect(),
            locals: (0..self.num_locals).map(|i| format!("$l{i}")).collect(),
            stack: pending.stack.clone(),
            bindings: Vec::new(),
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
        })
    }

    /// Wrap the block's terminator in its bindings, fuel check and parameters.
    fn render_block(&self, pending: &Pending, env: &BlockEnv, terminator: &str, cost: usize) -> String {
        let mut params = vec![
            "$F extends string".to_string(),
            "$M extends $Node".to_string(),
        ];
        for i in 0..self.module.globals.len() {
            params.push(format!("$g{i} extends WasmValue"));
        }
        for i in 0..self.num_locals {
            params.push(format!("$l{i} extends WasmValue"));
        }
        for name in &pending.stack {
            params.push(format!("{name} extends WasmValue"));
        }

        let mut inner = String::new();
        for (name, constraint, expr) in &env.bindings {
            inner.push_str(&format!("{expr} extends infer {name} extends {constraint}\n  ? "));
        }
        inner.push_str(terminator);
        for _ in &env.bindings {
            inner.push_str("\n  : never");
        }

        let body = {
            // out of fuel: hand the block id and everything live back to the host
            let mut live = vec!["$M".to_string()];
            for i in 0..self.module.globals.len() {
                live.push(format!("$g{i}"));
            }
            for i in 0..self.num_locals {
                live.push(format!("$l{i}"));
            }
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
        if self.num_results == 0 {
            Ok(format!("['r', {}]", env.memory))
        } else {
            let value = env
                .stack
                .last()
                .cloned()
                .unwrap_or_else(|| format!("'{}'", zero()));
            Ok(format!("['r', {}, {}]", env.memory, value))
        }
    }

    /// Tail-call a block, passing the stack it expects: everything below the
    /// label, then the operands it consumes off the top.
    fn call_block(&self, id: usize, env: &BlockEnv, floor: usize, arity: usize) -> String {
        let mut args = vec!["$F".to_string(), env.memory.clone()];
        args.extend(env.globals.iter().cloned());
        args.extend(env.locals.iter().cloned());
        let floor = floor.min(env.stack.len());
        args.extend(env.stack[..floor].iter().cloned());
        let take = arity.min(env.stack.len() - floor);
        args.extend(env.stack[env.stack.len() - take..].iter().cloned());
        format!("{}<{}>", self.block_name(id), args.join(", "))
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
            I32Mul => env.binary("Wasm.I32Mul", Ok(Step::Continue)),
            I32DivS => env.binary("Wasm.I32DivS", Ok(Step::Continue)),
            I32DivU => env.binary("Wasm.I32DivU", Ok(Step::Continue)),
            I32RemS => env.binary("Wasm.I32RemS", Ok(Step::Continue)),
            I32RemU => env.binary("Wasm.I32RemU", Ok(Step::Continue)),
            I32And => env.binary("Wasm.I32And", Ok(Step::Continue)),
            I32Or => env.binary("Wasm.I32Or", Ok(Step::Continue)),
            I32Xor => env.binary("Wasm.I32Xor", Ok(Step::Continue)),
            I32Shl => env.binary("Wasm.I32Shl", Ok(Step::Continue)),
            I32ShrU => env.binary("Wasm.I32ShrU", Ok(Step::Continue)),
            I32ShrS => env.binary("Wasm.I32ShrS", Ok(Step::Continue)),
            I32Rotl => env.binary("Wasm.I32Rotl", Ok(Step::Continue)),
            I32Rotr => env.binary("Wasm.I32Rotr", Ok(Step::Continue)),
            I32Eq => env.binary("Wasm.I32Eq", Ok(Step::Continue)),
            I32Ne => env.binary("Wasm.I32Neq", Ok(Step::Continue)),
            I32LtS => env.binary("Wasm.I32LtS", Ok(Step::Continue)),
            I32LtU => env.binary("Wasm.I32LtU", Ok(Step::Continue)),
            I32GtS => env.binary("Wasm.I32GtS", Ok(Step::Continue)),
            I32GtU => env.binary("Wasm.I32GtU", Ok(Step::Continue)),
            I32LeS => env.binary("Wasm.I32LeS", Ok(Step::Continue)),
            I32LeU => env.binary("Wasm.I32LeU", Ok(Step::Continue)),
            I32GeS => env.binary("Wasm.I32GeS", Ok(Step::Continue)),
            I32GeU => env.binary("Wasm.I32GeU", Ok(Step::Continue)),
            I32Eqz => env.unary("Wasm.I32Eqz", Ok(Step::Continue)),
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
                let then_id = self.fresh_id();
                self.pending.push(Pending {
                    id: then_id,
                    pos,
                    labels: inner_labels.clone(),
                    stack: env.stack.clone(),
                });
                let else_id = self.fresh_id();
                self.pending.push(Pending {
                    id: else_id,
                    pos: else_pos.map(|p| p + 1).unwrap_or(end_pos),
                    labels: inner_labels,
                    stack: env.stack.clone(),
                });
                let mut args = vec!["$F".to_string(), env.memory.clone()];
                args.extend(env.globals.iter().cloned());
                args.extend(env.locals.iter().cloned());
                args.extend(env.stack.iter().cloned());
                let arg_list = args.join(", ");
                Ok(Step::Terminate(format!(
                    "{cond} extends '{z}'\n  ? {}<{arg_list}>\n  : {}<{arg_list}>",
                    self.block_name(else_id),
                    self.block_name(then_id),
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
                    stack: env.stack.clone(),
                });
                let mut args = vec!["$F".to_string(), env.memory.clone()];
                args.extend(env.globals.iter().cloned());
                args.extend(env.locals.iter().cloned());
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
    memory: String,
    globals: Vec<String>,
    locals: Vec<String>,
    stack: Vec<String>,
    /// (name, constraint, expression) bindings, in order
    bindings: Vec<(String, String, String)>,
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

    fn local(&self, index: u32) -> Result<String, String> {
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
        let name = format!("$t{}", self.next_temp);
        self.next_temp += 1;
        self.bindings
            .push((name.clone(), constraint.to_string(), expr.to_string()));
        name
    }

    fn binary(&mut self, op: &str, ret: Result<Step, String>) -> Result<Step, String> {
        let b = self.pop();
        let a = self.pop();
        let value = format!("{op}<{a}, {b}>");
        let named = self.bind(&value, "WasmValue");
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
        ret
    }
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
