// Loaded by Monaco's TypeScript worker (setWorkerOptions customWorkerPath).
// Adds evalInputs(): asks the same checker that powers the editor's hints to
// resolve `type Inputs`, then reads the resulting tuple back as plain data.
// Nothing here parses the script text; if the checker can't compute the type,
// the run doesn't start.
self.customTSWorkerFactory = (TSWorker, tsArg) => class extends TSWorker {
  async evalInputs(fileName) {
    const ts = tsArg && tsArg.SyntaxKind ? tsArg : self.ts;
    const program = this._languageService.getProgram();
    const sf = program.getSourceFile(fileName);
    if (!sf) return { error: `no source file ${fileName}` };

    const errors = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)]
      .filter((d) => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) {
      // The innermost span is the useful one: a bad key also fails Run<>'s
      // constraint on the whole tuple, but the hold<> error points at the key.
      const d = errors.reduce((a, b) => ((b.length ?? 1e9) < (a.length ?? 1e9) ? b : a));
      const at = d.start != null ? `line ${sf.getLineAndCharacterOfPosition(d.start).line + 1}: ` : "";
      return { error: at + ts.flattenDiagnosticMessageText(d.messageText, "\n") };
    }

    const decl = sf.statements.find((s) => ts.isTypeAliasDeclaration(s) && s.name.text === "Inputs");
    if (!decl) return { error: "declare `type Inputs = [ ... ]`" };

    const checker = program.getTypeChecker();
    const isTuple = (t) => !!(t.flags & ts.TypeFlags.Object)
      && !!(t.objectFlags & ts.ObjectFlags.Reference)
      && !!(t.target.objectFlags & ts.ObjectFlags.Tuple);
    const show = (t) => checker.typeToString(t).slice(0, 120);
    const literal = (t) => {
      if (t.flags & (ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral)) return t.value;
      throw new Error(`expected a literal, got ${show(t)}`);
    };
    const keysOf = (t) => {
      if (t.flags & ts.TypeFlags.StringLiteral) return [t.value];
      if (isTuple(t)) return checker.getTypeArguments(t).map(literal);
      throw new Error(`expected Key[] , got ${show(t)}`);
    };
    const prop = (t, name) => {
      const sym = t.getProperty(name);
      return sym && checker.getTypeOfSymbolAtLocation(sym, decl);
    };

    // A Move type as [forward, side (+ right), turn (+ left), buttons], a ticcmd's fields.
    const MOVE = ["forward", "back", "strafeLeft", "strafeRight", "turnLeft", "turnRight", "fire", "use"];
    const moveOf = (t) => {
      const m = {};
      for (const sym of checker.getPropertiesOfType(t)) {
        const name = sym.getName();
        if (!MOVE.includes(name)) throw new Error(`"${name}" is not a Move field (${MOVE.join(", ")})`);
        const v = checker.getTypeOfSymbolAtLocation(sym, decl);
        if (name === "fire" || name === "use") {
          if (show(v) !== "true") throw new Error(`${name} must be true, got ${show(v)}`);
          m[name] = 1;
          continue;
        }
        const n = literal(v);
        if (!(Number.isInteger(n) && n >= 0 && n <= 127)) throw new Error(`${name} must be 0 to 127, got ${n}`);
        m[name] = n;
      }
      for (const [x, y] of [["forward", "back"], ["strafeLeft", "strafeRight"], ["turnLeft", "turnRight"]])
        if (m[x] && m[y]) throw new Error(`a Move can't have both ${x} and ${y}`);
      return [
        (m.forward ?? 0) - (m.back ?? 0),
        (m.strafeRight ?? 0) - (m.strafeLeft ?? 0),
        (m.turnLeft ?? 0) - (m.turnRight ?? 0),
        (m.fire ?? 0) | ((m.use ?? 0) << 1),
      ];
    };
    const movesOf = (t) => {
      if (!isTuple(t)) throw new Error(`expected Move[], got ${show(t)}`);
      return checker.getTypeArguments(t).map((m, k) => {
        try { return moveOf(m); } catch (err) { throw new Error(`tic ${k}: ${err.message}`); }
      });
    };

    const inputs = checker.getTypeAtLocation(decl.name);
    if (!isTuple(inputs)) return { error: `Inputs must be a tuple, got ${show(inputs)}` };
    try {
      const steps = checker.getTypeArguments(inputs).map((e, i) => {
        try {
          if (isTuple(e)) return { keys: keysOf(e) };
          const keys = prop(e, "keys");
          const playDemo = prop(e, "playDemo");
          const extendDemo = prop(e, "extendDemo");
          const setDemoTic = prop(e, "setDemoTic");
          if (!keys && !playDemo && !extendDemo && !setDemoTic)
            throw new Error(`expected Key[] or { keys, playDemo, extendDemo, setDemoTic }, got ${show(e)}`);
          if (!!playDemo + !!extendDemo + !!setDemoTic > 1) throw new Error("one of playDemo, extendDemo, setDemoTic per tic");
          const set = setDemoTic && checker.getTypeArguments(setDemoTic);
          return {
            keys: keys ? keysOf(keys) : [],
            playDemo: playDemo && movesOf(playDemo),
            extendDemo: extendDemo && movesOf(extendDemo),
            setDemoTic: set && [literal(set[0]), moveOf(set[1])],
          };
        } catch (err) {
          throw new Error(`Inputs[${i}]: ${err.message}`);
        }
      });
      return { steps };
    } catch (err) {
      return { error: err.message };
    }
  }
};
