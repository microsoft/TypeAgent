// Rule checking: evaluates the compiled rules (rules.gen.ts) against the
// calls a test makes, so that a contract checks the design's own
// statements instead of restating them.
//
// observe(target, options) returns a proxy for target. Each call made
// through it (a method call, or reading a property) is recorded in
// target's history (history in rules.ts), and the rules that apply to it
// are checked: @requires on entry (a broken one is the test's own fault,
// so it throws), and @ensures on return. checkInvariants checks the
// @invariant rules, and the proxy checks them whenever the object emits
// an event too.
//
// The rules that apply to a call of member m on an object used as
// interface I: for I and each interface it extends, the rules in m's doc,
// and the rules in the interface's doc when m is one of its members, its
// own or inherited.

import { recordCall, type Call, type Emitted } from "./rules.ts";
import { compiledRules, interfaceShapes, type CompiledRule } from "./rules.gen.ts";

export type Violation = (rule: string, detail: string) => void;

/** Something whose events the observer listens to. */
interface Emitter {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
}

export interface ObserveOptions {
  /** The interface the object is used as, such as "ShapeCollectionWriter". */
  readonly as: string;
  readonly violation: Violation;
  /** The events to record, by the emitter that emits them: "" for the object itself, or a member's name, such as "model". */
  readonly events?: Readonly<Record<string, readonly string[]>>;
  /** Members whose own members are called through them, such as "local": a call recorded as "local.enqueue". */
  readonly through?: readonly string[];
  /** Members read without being recorded or checked. */
  readonly unobserved?: readonly string[];
  /** The values to check a rule written as an arrow function on, by rule ID, as argument lists. */
  readonly samples?: (id: string) => readonly (readonly unknown[])[];
}

interface Frame {
  readonly call: { member: string; args: readonly unknown[]; result: unknown; emitted: Emitted[]; nested: Call[] };
  readonly rules: readonly CompiledRule[];
  readonly args: readonly unknown[];
  readonly at: unknown[][];
}

const ancestors = (as: string): readonly string[] => {
  const shape = interfaceShapes[as];
  if (!shape) throw new Error(`no interface ${as} in rules.gen.ts`);
  return shape.ancestors;
};

/** The members of iface, its own and those it inherits. */
function membersOf(iface: string): Set<string> {
  return new Set(ancestors(iface).flatMap((a) => interfaceShapes[a]?.members ?? []));
}

const membersCache = new Map<string, Set<string>>();
const members = (iface: string) => membersCache.get(iface) ?? membersCache.set(iface, membersOf(iface)).get(iface)!;

/** The compiled rules that apply to a call of member (such as "add", or "local.enqueue") on an object used as as. */
export function rulesFor(as: string, member: string): CompiledRule[] {
  const head = member.split(".")[0];
  const lineage = new Set(ancestors(as));
  return compiledRules.filter((r) => lineage.has(r.iface) && r.when !== "invariant" &&
    (r.member === null ? members(r.iface).has(head) : r.member === member));
}

/** A copy of v as it is now: plain objects and arrays copied one level down, anything else as is. */
function copy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map((x) => (Array.isArray(x) ? [...x] : x));
  if (v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Array.isArray(x) ? [...x] : x]));
  }
  return v;
}

function report(r: CompiledRule, value: unknown, options: ObserveOptions, detail: string): void {
  if (typeof value === "function") {
    const samples = options.samples?.(r.id);
    if (!samples) throw new Error(`${r.id} is written for every value of its parameters: give observe samples for it`);
    for (const s of samples) {
      if (!value(...s)) {
        options.violation(r.id, `${detail}, for ${JSON.stringify(s)}`);
        return;
      }
    }
  } else if (!value) options.violation(r.id, detail);
}

/** Checks target's @invariant rules as target is now. */
export function checkInvariants(target: object, options: ObserveOptions, when = "when checked"): void {
  const lineage = new Set(ancestors(options.as));
  for (const r of compiledRules) {
    if (r.when !== "invariant" || !lineage.has(r.iface)) continue;
    report(r, r.post.call(target, [], [], undefined), options, when);
  }
}

/** A proxy for target that records each call made through it and checks the rules that apply. */
export function observe<T extends object>(target: T, options: ObserveOptions): T {
  const stack: Frame[] = [];

  for (const [from, events] of Object.entries(options.events ?? {})) {
    const emitter = (from === "" ? target : (target as Record<string, unknown>)[from]) as Emitter;
    for (const event of events) {
      emitter.on(event, (...args: unknown[]) => {
        const frame = stack.at(-1);
        if (frame) {
          frame.call.emitted.push({ event: from === "" ? event : `${from}.${event}`, args });
          frame.at.push(frame.rules.map((r) => r.at.call(target, ...frame.args)));
        }
        if (from === "") checkInvariants(target, options, `at a ${event} event`);
      });
    }
  }

  const finish = (frame: Frame, pres: unknown[], result: unknown): void => {
    const call = frame.call;
    call.result = copy(result);
    const outer = stack.at(-1);
    const undo = recordCall(target, call);
    frame.rules.forEach((r, i) => {
      if (r.when === "entry") return;
      const value = r.post.call(target, pres[i], frame.at.map((a) => a[i]), result, ...frame.args);
      if (r.tag === "requires") {
        if (!value) throw new Error(`the test broke ${r.id}, calling ${call.member}`);
        return;
      }
      report(r, value, options, `after ${call.member}(${frame.args.map((a) => JSON.stringify(a) ?? String(a)).join(", ")})`);
    });
    if (outer) {
      undo();
      outer.call.nested.push(call);
    }
  };

  const invoke = (member: string, run: (...args: unknown[]) => unknown, args: unknown[]): unknown => {
    const rules = rulesFor(options.as, member);
    for (const r of rules) {
      if (r.when === "entry" && !r.post.call(target, [], [], undefined, ...args)) {
        throw new Error(`the test broke ${r.id}, calling ${member}`);
      }
    }
    const pres = rules.map((r) => r.pre.call(target, ...args));
    const frame: Frame = { call: { member, args: args.map(copy), result: undefined, emitted: [], nested: [] }, rules, args, at: [] };
    stack.push(frame);
    let result: unknown;
    try {
      result = run(...args);
    } catch (e) {
      stack.pop();
      throw e;
    }
    if (result instanceof Promise) {
      return result.then((settled) => {
        stack.splice(stack.lastIndexOf(frame), 1);
        finish(frame, pres, settled);
        return settled;
      });
    }
    stack.pop();
    finish(frame, pres, result);
    return result;
  };

  const through = (name: string, inner: object): object => new Proxy(inner, {
    get(t, key) {
      const v = Reflect.get(t, key, t);
      if (typeof key !== "string" || typeof v !== "function") return v;
      return (...args: unknown[]) => invoke(`${name}.${key}`, (...a) => Reflect.apply(v, t, a), args);
    },
  });

  const all = members(options.as);
  return new Proxy(target, {
    get(t, key) {
      if (typeof key !== "string" || !all.has(key) || options.unobserved?.includes(key)) return Reflect.get(t, key, t);
      const v = Reflect.get(t, key, t);
      if (options.through?.includes(key)) return through(key, v as object);
      if (typeof v === "function") return (...args: unknown[]) => invoke(key, (...a) => Reflect.apply(v, t, a), args);
      return invoke(key, () => Reflect.get(t, key, t), []);
    },
  });
}
