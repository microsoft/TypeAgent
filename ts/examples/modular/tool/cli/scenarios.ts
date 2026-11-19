/**
 * Scenario checking: the scenario subset, and the judge.
 *
 * The subset. A scenarios file has imports and const declarations only.
 * A scenario's play function may have a block body of const declarations
 * and expression statements; every other arrow function has an expression
 * body. Expressions are names in scope, literals, array and object
 * literals, property reads, arithmetic, comparisons, logical operators and
 * ?:, and calls on the instances, on names in scope (the vocabulary, or a
 * const lambda) and on the array built-ins below. There is no assignment,
 * no loop and no if, so the only effects are calls on the instances.
 *
 * The judge. Each scenario is played on the project's references, with
 * every rule checked on every call (ruleCheck.ts) and its expectations
 * recorded. A scenario with values after its instances is played for many
 * generated values. Then:
 * - allowed: judged when the references break no rule and every
 *   expectation holds: the references' states are a witness that the rules
 *   allow it. If an expectation fails, the references don't show the
 *   scenario is allowed, which is reported as a failure.
 * - forbidden: if the references play it without breaking a rule, the
 *   rules allow it, which is a failure. Otherwise it is unproved: only a
 *   proof shows that no implementation can play it.
 * A reference that breaks a rule is a failure either way.
 * Imports: ruleCheck.ts, fast-check, typescript-6 (for its parser),
 * node:fs, node:path, node:url
 */

import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript-6";
import { ruleChecker, type RuleSet } from "./ruleCheck.ts";

/** Array methods a scenario may call. All of them leave the array unchanged. */
const builtins = new Set(["map", "forEach", "every", "some", "filter", "reduce", "slice", "includes", "indexOf", "concat", "join", "flatMap", "at"]);

/** The type of a value a scenario is played for, as far as values can be generated for it. */
type ValueType =
  | { kind: "string" | "number" | "boolean" }
  | { kind: "array"; of: ValueType }
  | { kind: "unsupported"; text: string };

interface Param {
  readonly name: string;
  /** The interface an instance is used as, or undefined for a value. */
  readonly iface?: string;
  readonly type: ValueType;
}

/** What the parser finds in a scenarios file: problems with the subset, and each scenario's parameters by ID. */
export interface ScenarioSyntax {
  readonly problems: string[];
  readonly params: Map<string, Param[]>;
}

function valueType(t: ts.TypeNode | undefined, sf: ts.SourceFile): ValueType {
  if (!t) return { kind: "unsupported", text: "no type" };
  if (t.kind === ts.SyntaxKind.StringKeyword) return { kind: "string" };
  if (t.kind === ts.SyntaxKind.NumberKeyword) return { kind: "number" };
  if (t.kind === ts.SyntaxKind.BooleanKeyword) return { kind: "boolean" };
  if (ts.isTypeOperatorNode(t) && t.operator === ts.SyntaxKind.ReadonlyKeyword) return valueType(t.type, sf);
  if (ts.isArrayTypeNode(t)) return { kind: "array", of: valueType(t.elementType, sf) };
  return { kind: "unsupported", text: t.getText(sf) };
}

/** Checks a scenarios file against the subset, and finds each scenario's parameters. interfaces are the design's interface names. */
export function parseScenarios(dir: string, file: string, interfaces: ReadonlySet<string>): ScenarioSyntax {
  const sf = ts.createSourceFile(file, readFileSync(join(dir, file), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const problems: string[] = [];
  const params = new Map<string, Param[]>();
  const where = (n: ts.Node) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
  const bad = (n: ts.Node, what: string) => problems.push(`${where(n)}: ${what} isn't in the scenario subset`);
  const syntax = (n: ts.Node) =>
    ts.isVariableStatement(n) ? "a let or var declaration"
    : ts.isIfStatement(n) || ts.isSwitchStatement(n) ? "an if or switch statement (use ?:)"
    : ts.isIterationStatement(n, false) ? "a loop (use forEach or map)"
    : ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) ? "a function or class declaration (use a const arrow function)"
    : `the syntax ${ts.SyntaxKind[n.kind]}`;

  const top = new Set<string>(["undefined"]);
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s)) {
      const b = s.importClause;
      if (b?.name) top.add(b.name.text);
      if (b?.namedBindings && ts.isNamedImports(b.namedBindings)) for (const e of b.namedBindings.elements) top.add(e.name.text);
    } else if (ts.isVariableStatement(s) && s.declarationList.flags & ts.NodeFlags.Const) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) top.add(d.name.text);
    } else {
      bad(s, syntax(s));
    }
  }

  const expr = (n: ts.Expression, scope: ReadonlySet<string>, instances: ReadonlySet<string>): void => {
    const e = (x: ts.Expression) => expr(x, scope, instances);
    if (ts.isIdentifier(n)) {
      if (!scope.has(n.text)) bad(n, `the name ${n.text}, which isn't an import, a const or a parameter,`);
    } else if (ts.isStringLiteral(n) || ts.isNumericLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ||
      n.kind === ts.SyntaxKind.TrueKeyword || n.kind === ts.SyntaxKind.FalseKeyword || n.kind === ts.SyntaxKind.NullKeyword) {
      // literals
    } else if (ts.isArrayLiteralExpression(n)) {
      n.elements.forEach((x) => e(ts.isSpreadElement(x) ? x.expression : x));
    } else if (ts.isObjectLiteralExpression(n)) {
      for (const p of n.properties) {
        if (ts.isPropertyAssignment(p)) e(p.initializer);
        else if (ts.isShorthandPropertyAssignment(p)) e(p.name);
        else if (ts.isSpreadAssignment(p)) e(p.expression);
        else bad(p, "a method or accessor in an object literal");
      }
    } else if (ts.isPropertyAccessExpression(n)) {
      e(n.expression);
    } else if (ts.isElementAccessExpression(n)) {
      e(n.expression);
      e(n.argumentExpression);
    } else if (ts.isCallExpression(n)) {
      const c = n.expression;
      if (ts.isIdentifier(c)) e(c);
      else if (ts.isPropertyAccessExpression(c) && ts.isIdentifier(c.expression) && instances.has(c.expression.text)) {
        // a call on an instance: the scenario's effects
      } else if (ts.isPropertyAccessExpression(c) && builtins.has(c.name.text)) e(c.expression);
      else bad(c, `calling ${c.getText(sf)}`);
      n.arguments.forEach(e);
    } else if (ts.isArrowFunction(n)) {
      if (!ts.isExpression(n.body)) bad(n, "an arrow function with a block body");
      else expr(n.body, withParams(n, scope), instances);
    } else if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      if ((op >= ts.SyntaxKind.FirstAssignment && op <= ts.SyntaxKind.LastAssignment) || op === ts.SyntaxKind.CommaToken) {
        bad(n, `the operator ${n.operatorToken.getText(sf)}`);
      }
      e(n.left);
      e(n.right);
    } else if (ts.isPrefixUnaryExpression(n)) {
      if (n.operator === ts.SyntaxKind.PlusPlusToken || n.operator === ts.SyntaxKind.MinusMinusToken) bad(n, "++ or --");
      e(n.operand);
    } else if (ts.isConditionalExpression(n)) {
      e(n.condition);
      e(n.whenTrue);
      e(n.whenFalse);
    } else if (ts.isParenthesizedExpression(n)) {
      e(n.expression);
    } else {
      bad(n, syntax(n));
    }
  };

  const withParams = (f: ts.ArrowFunction, scope: ReadonlySet<string>) => {
    const inner = new Set(scope);
    for (const p of f.parameters) {
      if (ts.isIdentifier(p.name) && !p.initializer && !p.dotDotDotToken) inner.add(p.name.text);
      else bad(p, "a destructured, default or rest parameter");
    }
    return inner;
  };

  /** A play function: its block body may hold const declarations and expression statements. */
  const play = (f: ts.ArrowFunction, scope: ReadonlySet<string>): Param[] => {
    const ps: Param[] = f.parameters.map((p) => {
      const t = p.type;
      const name = ts.isIdentifier(p.name) ? p.name.text : p.name.getText(sf);
      if (t && ts.isTypeReferenceNode(t) && ts.isIdentifier(t.typeName) && interfaces.has(t.typeName.text)) {
        return { name, iface: t.typeName.text, type: { kind: "unsupported", text: t.typeName.text } };
      }
      return { name, type: valueType(t, sf) };
    });
    const instances = new Set(ps.filter((p) => p.iface).map((p) => p.name));
    const inner = new Set(withParams(f, scope));
    if (ts.isExpression(f.body)) expr(f.body, inner, instances);
    else {
      for (const s of f.body.statements) {
        if (ts.isExpressionStatement(s)) expr(s.expression, inner, instances);
        else if (ts.isVariableStatement(s) && s.declarationList.flags & ts.NodeFlags.Const) {
          for (const d of s.declarationList.declarations) {
            if (d.initializer) expr(d.initializer, inner, instances);
            if (ts.isIdentifier(d.name)) inner.add(d.name.text);
            else bad(d, "a destructuring declaration");
          }
        } else bad(s, syntax(s));
      }
    }
    return ps;
  };

  const visitTop = (n: ts.Expression) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "scenario") {
      const [id, kind, headline, body, cond] = n.arguments;
      if (!id || !ts.isStringLiteral(id) || !kind || !ts.isStringLiteral(kind) || !headline || !ts.isStringLiteral(headline)) {
        bad(n, "a scenario without string literals for its ID, kind and headline");
        return;
      }
      if (params.has(id.text)) problems.push(`${where(id)}: the scenario ${id.text} is defined twice`);
      if (!body || !ts.isArrowFunction(body)) bad(n, "a scenario whose play isn't an arrow function");
      else params.set(id.text, play(body, top));
      if (cond) expr(cond, top, new Set());
    } else if (ts.isArrayLiteralExpression(n)) {
      n.elements.forEach((x) => visitTop(x as ts.Expression));
    } else {
      expr(n, top, new Set());
    }
  };
  for (const s of sf.statements) {
    if (ts.isVariableStatement(s)) for (const d of s.declarationList.declarations) if (d.initializer) visitTop(d.initializer);
  }
  return { problems, params };
}

/** How the judge makes an instance of an interface: a reference file and its maker function. */
export type References = Readonly<Record<string, { readonly file: string; readonly make: string }>>;

interface Scenario {
  readonly id: string;
  readonly kind: "allowed" | "forbidden";
  readonly play: (...args: unknown[]) => void;
  readonly where?: (...values: unknown[]) => boolean;
}

/** One play of a scenario: what went wrong, and which expectations failed (by position). */
interface Play {
  readonly violations: string[];
  /** Set when the scenario broke a @requires rule, or something threw. */
  error?: string;
  readonly failed: number[];
}

const arbitrary = (t: ValueType): fc.Arbitrary<unknown> | undefined => {
  if (t.kind === "string") return fc.string({ maxLength: 8 });
  if (t.kind === "number") return fc.integer({ min: -1000, max: 1000 });
  if (t.kind === "boolean") return fc.boolean();
  if (t.kind === "array") {
    const of = arbitrary(t.of);
    return of && fc.array(of, { maxLength: 10 });
  }
  return undefined;
};

export interface Judgement {
  readonly problems: string[];
  readonly judged: string[];
  readonly unproved: string[];
}

/** Plays each scenario on the references with the rules checked, as the module header describes. */
export async function judgeScenarios(options: {
  dir: string;
  scenariosFile: string;
  ruleLanguage: string;
  rules: RuleSet;
  references: References;
  syntax: ScenarioSyntax;
}): Promise<Judgement> {
  const { dir, rules, references, syntax } = options;
  const url = (f: string) => pathToFileURL(join(dir, f)).href;
  const language = (await import(url(options.ruleLanguage))) as {
    withExpectations: <T>(sink: (holds: boolean) => void, play: () => T) => T;
  };
  const module = (await import(url(options.scenariosFile))) as { scenarios?: readonly Scenario[] };
  if (!Array.isArray(module.scenarios)) return { problems: [`${options.scenariosFile} doesn't export scenarios`], judged: [], unproved: [] };
  const makers = new Map<string, () => object>();
  for (const [iface, ref] of Object.entries(references)) {
    const m = (await import(url(ref.file))) as Record<string, unknown>;
    const make = m[ref.make];
    if (typeof make !== "function") return { problems: [`${ref.file} doesn't export a function ${ref.make}`], judged: [], unproved: [] };
    makers.set(iface, make as () => object);
  }
  const { observe } = ruleChecker(rules);

  const playOnce = (s: Scenario, ps: Param[], values: unknown[]): Play => {
    const result: Play = { violations: [], failed: [] };
    let n = 0;
    try {
      const instances = ps.filter((p) => p.iface).map((p) => observe(makers.get(p.iface!)!(), {
        as: p.iface!,
        violation: (rule, detail) => result.violations.push(`${rule} ${detail}`),
        invariantsAfterCalls: true,
      }));
      language.withExpectations((holds) => {
        if (!holds) result.failed.push(n);
        n++;
      }, () => s.play(...instances, ...values));
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }
    return result;
  };

  const problems: string[] = [];
  const judged: string[] = [];
  const unproved: string[] = [];
  const seed = Number(process.env.FC_SEED ?? "1");
  for (const s of module.scenarios) {
    const ps = syntax.params.get(s.id);
    if (!ps) {
      problems.push(`${s.id}: not found in ${options.scenariosFile}`);
      continue;
    }
    const missing = ps.filter((p) => p.iface && !makers.has(p.iface)).map((p) => p.iface);
    if (missing.length) {
      problems.push(`${s.id}: no reference for ${missing.join(", ")} in typearc.json`);
      continue;
    }
    const valueParams = ps.filter((p) => !p.iface);
    const arbs = valueParams.map((p) => arbitrary(p.type));
    const unsupported = valueParams.filter((_, i) => !arbs[i]).map((p) => `${p.name}: ${p.type.kind === "unsupported" ? p.type.text : p.type.kind}`);
    if (unsupported.length) {
      problems.push(`${s.id}: can't generate values for ${unsupported.join(", ")}`);
      continue;
    }
    const sound = (p: Play) => p.violations.length === 0 && p.error === undefined;
    const plays = (p: Play) => sound(p) && p.failed.length === 0;
    // A forbidden scenario must not play; an allowed one must.
    const ok = (p: Play) => (s.kind === "allowed" ? plays(p) : sound(p) && p.failed.length > 0);
    let counter: { play: Play; values: unknown[] } | undefined;
    if (valueParams.length === 0) {
      const p = playOnce(s, ps, []);
      if (!ok(p)) counter = { play: p, values: [] };
    } else {
      const property = fc.property(fc.tuple(...(arbs as fc.Arbitrary<unknown>[])), (values) => {
        if (s.where) fc.pre(s.where(...values));
        return ok(playOnce(s, ps, values));
      });
      const run = fc.check(property, { seed, numRuns: 100 });
      if (run.failed && run.counterexample) {
        const values = run.counterexample[0] as unknown[];
        counter = { play: playOnce(s, ps, values), values };
      }
    }
    if (!counter) {
      (s.kind === "allowed" ? judged : unproved).push(s.id);
      continue;
    }
    const at = counter.values.length ? ` with ${valueParams.map((p, i) => `${p.name} = ${JSON.stringify(counter.values[i])}`).join(", ")}` : "";
    const p = counter.play;
    if (p.error !== undefined) {
      const broke = /the test broke ([^,\s]+)/.exec(p.error)?.[1];
      problems.push(broke ? `${s.id}: the scenario breaks ${broke}${at}, so it is outside the rules` : `${s.id}: threw ${p.error}${at}`);
    } else if (p.violations.length) {
      problems.push(`${s.id}: the reference breaks ${p.violations[0]}${at}`);
    } else if (s.kind === "allowed") {
      problems.push(`${s.id}: expectation ${p.failed[0] + 1} fails on the reference${at}, so it isn't shown to be allowed`);
    } else {
      problems.push(`${s.id}: the rules allow it: the reference plays it without breaking a rule${at}`);
    }
  }
  return { problems, judged, unproved };
}
