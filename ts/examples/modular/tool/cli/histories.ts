/**
 * The history generator: makes histories of calls on an implementation,
 * each call keeping its @requires rules, so that the compiled rules can
 * judge every call (ruleCheck.ts). It never judges or defines a rule.
 *
 * How: reads each interface's members, and their parameter types, from the
 * interface files with TypeScript 6's parser. A history is a list of
 * steps, each a member with generated arguments; reading a property is a
 * step too. Steps whose @requires rules don't hold in the state reached so
 * far are skipped. fast-check generates many histories (seeded by
 * FC_SEED) and shrinks a failing one to the shortest that still fails.
 *
 * It reports the first rule broken, with the history that breaks it; with
 * a target rule (for an adversary), it looks for that rule only. It also
 * reports which rules no history evaluated, since a rule the generator
 * never reaches is checked by nothing.
 * Imports: ruleCheck.ts, scenarios.ts, fast-check, typescript-6, node:fs,
 * node:path
 */

import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript-6";
import { ruleChecker, type RuleSet } from "./ruleCheck.ts";
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
  /** The positions of the number parameters, and where the search for values that keep @requires starts. */
  readonly numbers?: readonly number[];
  readonly offset?: number;
}

/** The small numbers tried, in turn, for a call whose generated arguments break its @requires rules. */
const smallNumbers = 13;

/**
 * Arguments for step that keep its @requires rules: its own, or else the
 * first found by trying small numbers (0 to 12, starting at the step's
 * offset) for its number parameters. Random numbers rarely land in a
 * range that depends on the state, such as an index into a list, so
 * without this many calls would never be made.
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
  if (!lineage) return { others: new Set(), unevaluated: [], problem: `no interface ${as} in the rules` };
  const seen = new Set<string>();
  const members = lineage.flatMap((i) => options.members.get(i) ?? []).filter((m) => !seen.has(m.name) && seen.add(m.name));
  // Methods are weighted above property reads, so that histories change
  // the state often enough to reach the states rules are about.
  const steps: [fc.Arbitrary<Step>, number][] = [];
  for (const m of members) {
    const arbs = m.params.map((p) => arbitrary(p.type));
    const missing = m.params.filter((_, i) => !arbs[i]).map((p) => `${m.name}'s ${p.name}`);
    if (missing.length) return { others: new Set(), unevaluated: [], problem: `can't generate values for ${missing.join(", ")}` };
    steps.push(m.method
      ? [fc.tuple(fc.tuple(...(arbs as fc.Arbitrary<unknown>[])), fc.nat(smallNumbers ** 2)).map(([args, offset]): Step => ({
        member: m.name, method: true, args, offset,
        numbers: m.params.flatMap((p, i) => (p.type.kind === "number" ? [i] : [])),
      })), 4]
      : [fc.constant<Step>({ member: m.name, method: false, args: [] }), 1]);
  }
  const { observe, requiresHold } = ruleChecker(rules);
  const evaluated = new Set<string>();
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
      const args = argsKeeping(generated, (a) => requiresHold(target0, as, generated.member, a));
      if (!args) continue;
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
  const check = fc.check(fc.property(fc.array(fc.oneof(...steps.map(([s, w]) => ({ arbitrary: s, weight: w }))), { maxLength: 30, size: "max" }), (h) => passes(run(h))), {
    seed: Number(process.env.FC_SEED ?? "1"),
    numRuns: options.numRuns ?? 300,
  });
  const lineageSet = new Set(lineage);
  const unevaluated = rules.compiledRules.filter((r) => lineageSet.has(r.iface) && !evaluated.has(r.id)).map((r) => r.id);
  if (!check.failed || !check.counterexample) return { others, unevaluated };
  const r = run(check.counterexample[0]);
  const history = r.made.map(show);
  if (r.error !== undefined) return { threw: { error: r.error, history }, others, unevaluated };
  const b = r.broken.find((x) => !target || x.rule === target) ?? r.broken[0];
  return { failure: { rule: b.rule, detail: b.detail, history }, others, unevaluated };
}
