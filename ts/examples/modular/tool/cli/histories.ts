/**
 * The history generator: makes histories of calls on an implementation,
 * each call keeping its @requires rules, so that the compiled rules can
 * judge every call (ruleCheck.ts). It never judges or defines a rule.
 *
 * How: reads each interface's members, and their parameter types, from the
 * interface files with TypeScript 6's parser. A history is a list of
 * steps, each a member with generated arguments; reading a property is a
 * step too. A number parameter that a @requires rule bounds, such as
 * 0 <= index && index < this.length, is chosen within those bounds in the
 * state reached so far, favoring the edges, and each such call is put in
 * a category: the range's only position, low edge, high edge or middle;
 * other arguments that break a
 * @requires rule are searched for among small numbers, and a step that
 * still breaks one is skipped. fast-check generates many histories (seeded by
 * FC_SEED) and shrinks a failing one to the shortest that still fails.
 *
 * It reports the first rule broken, with the history that breaks it; with
 * a target rule (for an adversary), it looks for that rule only. It also
 * reports which rules no history evaluated, since a rule the generator
 * never reaches is checked by nothing, and which categories of a bounded
 * parameter no call reached.
 * Imports: ruleCheck.ts, scenarios.ts, fast-check, typescript-6, node:fs,
 * node:path
 */

import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript-6";
import { ruleChecker, type CompiledRule, type RuleSet } from "./ruleCheck.ts";
import { arbitrary, valueType, type ValueType } from "./scenarios.ts";

/** A member as the generator calls it: a method with typed parameters, or a property it reads. */
export interface MemberShape {
  readonly name: string;
  readonly method: boolean;
  readonly params: readonly { readonly name: string; readonly type: ValueType }[];
}

/** Each interface's own members, from the interface files (paths relative to dir). */
export function memberShapes(dir: string, files: readonly string[]): Map<string, MemberShape[]> {
  const shapes = new Map<string, MemberShape[]>();
  for (const file of files) {
    const sf = ts.createSourceFile(file, readFileSync(join(dir, file), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
    for (const s of sf.statements) {
      if (!ts.isInterfaceDeclaration(s)) continue;
      shapes.set(s.name.text, s.members.flatMap((m): MemberShape[] => {
        if (!m.name || !ts.isIdentifier(m.name)) return [];
        if (ts.isMethodSignature(m)) {
          return [{ name: m.name.text, method: true, params: m.parameters.map((p) => ({ name: p.name.getText(sf), type: valueType(p.type, sf) })) }];
        }
        return ts.isPropertySignature(m) ? [{ name: m.name.text, method: false, params: [] }] : [];
      }));
    }
  }
  return shapes;
}

interface Step {
  readonly member: string;
  readonly method: boolean;
  readonly args: readonly unknown[];
  /** The parameters' names, the positions of the number parameters, and where choices of in-range values start. */
  readonly names?: readonly string[];
  readonly numbers?: readonly number[];
  readonly offset?: number;
}

/** The range a @requires rule allows a number parameter, in the current state: lo or hi is absent when that side is open. */
interface Range {
  readonly lo?: number;
  readonly hi?: number;
}

/**
 * The categories of value a bounded number parameter can take: a range
 * with both ends has its only position (when lo equals hi), its low edge,
 * its high edge and its middle; a range open on one side has its edge and
 * the values beyond it. Off-by-one faults live at the edges; faults that
 * confuse one position with another need the middle.
 */
const categoriesOf = (r: Range): readonly string[] =>
  r.lo !== undefined && r.hi !== undefined ? ["only position", "low edge", "high edge", "middle"] : ["edge", "beyond the edge"];

function category(r: Range, v: number): string {
  if (r.lo !== undefined && r.hi !== undefined) {
    return r.lo === r.hi ? "only position" : v === r.lo ? "low edge" : v === r.hi ? "high edge" : "middle";
  }
  return v === (r.lo ?? r.hi) ? "edge" : "beyond the edge";
}

/**
 * Arguments with each bounded number parameter chosen within the bounds
 * its @requires rules put on it (boundsOf in ruleGen.ts), evaluated in
 * the current state: the lowest value one time in five, the highest one
 * time in five, and otherwise a value between, picked by the generated
 * number. Returns the ranges too, by parameter position, so the call can
 * be put in its categories. Returns undefined when a range is empty: no
 * call keeps the rules in this state.
 */
function inBounds(step: Step, rules: readonly CompiledRule[], target: object): { args: readonly unknown[]; ranges: Map<number, Range> } | undefined {
  const ranges = new Map<number, Range>();
  const bounded = rules.filter((r) => r.when === "entry" && r.bounds);
  if (bounded.length === 0 || !step.names) return { args: step.args, ranges };
  const args = [...step.args];
  const lo = new Map<string, number>();
  const hi = new Map<string, number>();
  for (const r of bounded) {
    const b = r.bounds!.call(target, ...args) as Record<string, readonly [readonly number[], readonly number[]]>;
    for (const [name, [los, his]] of Object.entries(b)) {
      for (const v of los) if (Number.isFinite(v)) lo.set(name, Math.max(lo.get(name) ?? -Infinity, Math.ceil(v)));
      for (const v of his) if (Number.isFinite(v)) hi.set(name, Math.min(hi.get(name) ?? Infinity, Math.floor(v)));
    }
  }
  for (const i of step.numbers ?? []) {
    const name = step.names[i];
    const l = lo.get(name);
    const h = hi.get(name);
    if (l === undefined && h === undefined) continue;
    const raw = Math.abs(Math.trunc(Number(step.args[i]))) || 0;
    const pick = ((step.offset ?? 0) + i) % 5;
    if (l !== undefined && h !== undefined) {
      if (l > h) return undefined;
      args[i] = pick === 0 ? l : pick === 1 ? h : l + (raw % (h - l + 1));
    } else if (l !== undefined) args[i] = l + (pick === 0 ? 0 : raw % smallNumbers);
    else if (h !== undefined) args[i] = h - (pick === 0 ? 0 : raw % smallNumbers);
    ranges.set(i, { lo: l, hi: h });
  }
  return { args, ranges };
}

/**
 * The most calls in a history. Lists in 30-call histories seldom reached
 * three items, so an index rarely fell in the middle of its range; at 100
 * the middle is common and a run still takes a fraction of a second.
 */
const historyLength = 100;

/** The small numbers tried, in turn, for a call whose generated arguments break its @requires rules. */
const smallNumbers = 13;

/**
 * Arguments for step that keep its @requires rules: its own, or else the
 * first found by trying small numbers (0 to 12, starting at the step's
 * offset) for its number parameters. This is the fallback for @requires
 * rules whose bounds inBounds can't read.
 */
function argsKeeping(step: Step, holds: (args: readonly unknown[]) => boolean): readonly unknown[] | undefined {
  if (holds(step.args)) return step.args;
  const positions = (step.numbers ?? []).slice(0, 2);
  if (positions.length === 0) return undefined;
  const tries = smallNumbers ** positions.length;
  for (let k = 0; k < tries; k++) {
    const args = [...step.args];
    let n = ((step.offset ?? 0) + k) % tries;
    for (const at of positions) {
      args[at] = n % smallNumbers;
      n = Math.floor(n / smallNumbers);
    }
    if (holds(args)) return args;
  }
  return undefined;
}

const show = (s: Step) => (s.method ? `${s.member}(${s.args.map((a) => JSON.stringify(a)).join(", ")})` : s.member);

/** What one history did: the steps made, the rules broken, and what an implementation threw. */
interface Run {
  readonly made: Step[];
  readonly broken: { rule: string; detail: string }[];
  error?: string;
}

export interface Generated {
  /** The rule broken (the target, if one was given), with the shortest history found that breaks it. */
  readonly failure?: { readonly rule: string; readonly detail: string; readonly history: readonly string[] };
  /** Set when an implementation threw on a call that kept its @requires rules. */
  readonly threw?: { readonly error: string; readonly history: readonly string[] };
  /** Rules broken while looking for the target, other than it. */
  readonly others: ReadonlySet<string>;
  /** Rules that apply to the interface but that no history evaluated. */
  readonly unevaluated: readonly string[];
  /** Categories of a bounded number parameter that no call reached, such as "get's index middle" (see categoriesOf). */
  readonly unreached: readonly string[];
  /** Why no histories could be made, such as a parameter type with no generator. */
  readonly problem?: string;
}

/** Makes histories on instances from make, used as the interface as. */
export function generateHistories(options: {
  rules: RuleSet;
  members: ReadonlyMap<string, MemberShape[]>;
  as: string;
  make: () => object;
  target?: string;
  numRuns?: number;
}): Generated {
  const { rules, as, make, target } = options;
  const lineage = rules.interfaceShapes[as]?.ancestors;
  if (!lineage) return { others: new Set(), unevaluated: [], unreached: [], problem: `no interface ${as} in the rules` };
  const seen = new Set<string>();
  const members = lineage.flatMap((i) => options.members.get(i) ?? []).filter((m) => !seen.has(m.name) && seen.add(m.name));
  // Methods are weighted above property reads, so that histories change
  // the state often enough to reach the states rules are about.
  const steps: [fc.Arbitrary<Step>, number][] = [];
  for (const m of members) {
    const arbs = m.params.map((p) => arbitrary(p.type));
    const missing = m.params.filter((_, i) => !arbs[i]).map((p) => `${m.name}'s ${p.name}`);
    if (missing.length) return { others: new Set(), unevaluated: [], unreached: [], problem: `can't generate values for ${missing.join(", ")}` };
    steps.push(m.method
      ? [fc.tuple(fc.tuple(...(arbs as fc.Arbitrary<unknown>[])), fc.nat(smallNumbers ** 2)).map(([args, offset]): Step => ({
        member: m.name, method: true, args, offset,
        names: m.params.map((p) => p.name),
        numbers: m.params.flatMap((p, i) => (p.type.kind === "number" ? [i] : [])),
      })), 4]
      : [fc.constant<Step>({ member: m.name, method: false, args: [] }), 1]);
  }
  const { observe, requiresHold, rulesFor } = ruleChecker(rules);
  const evaluated = new Set<string>();
  const reached = new Map<string, { all: readonly string[]; seen: Set<string> }>();
  const others = new Set<string>();

  const run = (history: readonly Step[]): Run => {
    const result: Run = { made: [], broken: [] };
    const target0 = make();
    const o = observe(target0, {
      as,
      violation: (rule, detail) => result.broken.push({ rule, detail }),
      invariantsAfterCalls: true,
      evaluated: (rule) => evaluated.add(rule),
    }) as Record<string, unknown>;
    for (const generated of history) {
      const bounded = generated.method ? inBounds(generated, rulesFor(as, generated.member), target0) : { args: generated.args, ranges: new Map<number, Range>() };
      if (!bounded) continue;
      const args = argsKeeping({ ...generated, args: bounded.args }, (a) => requiresHold(target0, as, generated.member, a));
      if (!args) continue;
      for (const [i, range] of bounded.ranges) {
        const key = `${generated.member}'s ${generated.names![i]}`;
        if (!reached.has(key)) reached.set(key, { all: categoriesOf(range), seen: new Set() });
        reached.get(key)!.seen.add(category(range, args[i] as number));
      }
      const step = { ...generated, args };
      result.made.push(step);
      try {
        const v = step.method ? (o[step.member] as (...a: unknown[]) => unknown)(...step.args) : o[step.member];
        if (v instanceof Promise) {
          result.error = `${step.member} returned a promise; the generator doesn't play asynchronous members yet`;
          break;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // A @requires rule checked on return (one that uses nested) was broken
        // by the history, not the implementation: end the history there.
        if (message.startsWith("the test broke")) result.made.pop();
        else result.error = message;
        break;
      }
      if (target ? result.broken.some((b) => b.rule === target) : result.broken.length) break;
    }
    return result;
  };

  const passes = (r: Run) => {
    for (const b of r.broken) if (b.rule !== target) others.add(b.rule);
    return r.error === undefined && (target ? !r.broken.some((b) => b.rule === target) : r.broken.length === 0);
  };
  const check = fc.check(fc.property(fc.array(fc.oneof(...steps.map(([s, w]) => ({ arbitrary: s, weight: w }))), { maxLength: historyLength, size: "max" }), (h) => passes(run(h))), {
    seed: Number(process.env.FC_SEED ?? "1"),
    numRuns: options.numRuns ?? 300,
  });
  const lineageSet = new Set(lineage);
  const unevaluated = rules.compiledRules.filter((r) => lineageSet.has(r.iface) && !evaluated.has(r.id)).map((r) => r.id);
  const unreached = [...reached].flatMap(([key, { all, seen }]) => all.filter((c) => !seen.has(c)).map((c) => `${key} ${c}`));
  const coverage = { others, unevaluated, unreached };
  if (!check.failed || !check.counterexample) return coverage;
  const r = run(check.counterexample[0]);
  const history = r.made.map(show);
  if (r.error !== undefined) return { threw: { error: r.error, history }, ...coverage };
  const b = r.broken.find((x) => !target || x.rule === target) ?? r.broken[0];
  return { failure: { rule: b.rule, detail: b.detail, history }, ...coverage };
}
