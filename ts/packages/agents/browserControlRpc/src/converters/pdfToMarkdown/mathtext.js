// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) 2026 Beatriz Almeida.
// Licensed under the MIT License; see LICENSE.
// Upstream source: https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/mathtext.js
// TypeAgent modifications: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Adapted source and provenance header; reversible patch recorded in ts/tools/scripts/converters/pdfToMarkdown/patches.
// Math inside running text, as LaTeX: "Se tg x − cotg x = 1, então…" ->
// "Se $\operatorname{tg} x - \operatorname{cotg} x = 1$, então…".
// The browser side of src/papero_extract/mathtext.py (the reasoning is there): keep both in
// sync — tests/js/parity.mjs compares them.

import { LATEX, SUB_FROM, SUB_TO, SUP_FROM, SUP_TO, latexEscape } from "./symbols.js";

const reverse = (from, to) => new Map([...to].map((c, i) => [c, from[i]]));
const SUP = reverse(SUP_FROM, SUP_TO); // "²" -> "2"
const SUB = reverse(SUB_FROM, SUB_TO);
const STRONG_OPS = new Set("=+−<>≤≥≠≈±×÷·⋅→⇒⇔∈∉⊂⊆∪∩∝≡∼");
const FUNCS = new Set(["sen", "sin", "cos", "tg", "tan", "cotg", "cot", "cossec", "csc", "arcsen", "arcsin", "arccos", "arctg", "arctan", "log", "ln", "lim", "mdc", "mmc"]);
const LATEX_FUNCS = new Set(["sin", "cos", "tan", "cot", "csc", "arcsin", "arccos", "arctan", "log", "ln", "lim"]);
const STOP = new Set("aeoAEOI"); // one-letter words: a variable only next to an operator
const ASCII_ALNUM = new Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
const SCRIPTS = new Set([...SUP.keys(), ...SUB.keys()]);
const SYMBOLS = new Set([...Object.keys(LATEX), ...STRONG_OPS, "^"]); // math whatever is around
const EXPR_CHARS = new Set([...ASCII_ALNUM, ...SYMBOLS, ...SCRIPTS, ..."-()[]|,.'%_/"]);

const NUM = /^[+\-−]?[0-9]+(?:[.,][0-9]+)*%?$/;
const COEF = /^[+\-−]?[0-9]+(?:[.,][0-9]+)*[A-Za-z]$/; // "2x"
const IDENT = /^[A-Za-z][A-Za-z0-9]{1,2}$/; // "Mn", "pH": math only beside an operator
const CALL = /^[A-Za-z]\([^()]*\)$/; // "f(x)"
const GROUP = /^\([A-Za-z0-9]+\)$/; // "(x)", "(2)": an argument when math is around it
// Lower-case names set upright; other lower-case letters together are a product: "ax", "mc".
const UNITS = new Set(["mol", "cm", "mm", "km", "dm", "nm", "kg", "mg", "ml", "cal", "atm", "rad", "min", "seg"]);
const nameOf = (w) => {
  const low = w.toLowerCase();
  if (LATEX_FUNCS.has(low)) return `\\${low} `;
  return FUNCS.has(low) || UNITS.has(w) || w !== low ? `\\operatorname{${w}}` : w; // "tg", "mol", "Mn", "mmHg"
};
// A name inside the math ("tg", "mol") — not the letters of an index: "a_(ij)".
const WORD = /(?<![\\A-Za-z])(?<![\^_]\()[A-Za-z]{2,}/g;
const ROOT = /\\sqrt\s*(\([^()]*\)|[0-9]+|[A-Za-z0-9])/g;
const SUP_RUN = new RegExp(`[${[...SUP.keys()].join("")}]+`, "gu");
const SUB_RUN = new RegExp(`[${[...SUB.keys()].join("")}]+`, "gu");

const count = (piece, chars) => [...piece].filter((c) => chars.includes(c)).length;
const balance = (piece) => count(piece, "([") - count(piece, ")]");

// A token without the brackets it does not close itself: "(x" -> "x", "f(x)" stays.
function innerOf(core) {
  while (core && "([".includes(core[0]) && balance(core) > 0) core = core.slice(1);
  while (core && ")]".includes(core[core.length - 1]) && balance(core) < 0) core = core.slice(0, -1);
  return core;
}

function kindOf(inner) {
  const chars = [...inner];
  if (!chars.length) return "word";
  if (chars.every((c) => STRONG_OPS.has(c))) return "op";
  if (inner === "-") return "wop";
  if (NUM.test(inner) || COEF.test(inner)) return "num";
  if (chars.length === 1) {
    if (SYMBOLS.has(inner)) return "expr";
    return ASCII_ALNUM.has(inner) ? "var" : "word";
  }
  if (FUNCS.has(inner.toLowerCase())) return "func";
  if (GROUP.test(inner)) return "num";
  if (chars.every((c) => EXPR_CHARS.has(c)) && chars.some((c) => ASCII_ALNUM.has(c))) {
    if (chars.some((c) => SYMBOLS.has(c)) || CALL.test(inner)) return "expr";
    // Only an exponent or an index says so: "cm³", "H₂O" — but not "method¹" (a note).
    const short = (inner.match(/[A-Za-z]+/g) || []).every((w) => w.length <= 3);
    if (short && chars.some((c) => SCRIPTS.has(c))) return "expr";
  }
  return IDENT.test(inner) ? "ident" : "word";
}

// [start, end] of each stretch of math in `text`, in order.
export function mathSpans(text) {
  const tokens = []; // { start, end: without the punctuation that follows, kind, inner }
  for (const m of text.matchAll(/[^ \n]+/g)) {
    const core = m[0].replace(/[,.;:!?]+$/, "");
    const inner = innerOf(core);
    tokens.push({ start: m.index, end: m.index + core.length, kind: kindOf(inner), inner });
  }
  // Kind of token `j` when only spaces separate it from token `i`.
  const beside = (i, j) => {
    if (j < 0 || j >= tokens.length) return "";
    const gap = text.slice(tokens[Math.min(i, j)].end, tokens[Math.max(i, j)].start);
    return gap && !gap.replace(/ /g, "") ? tokens[j].kind : "";
  };
  const spans = [];
  let run = [];
  const close = () => {
    while (run.length && tokens[run[0]].kind === "wop") run = run.slice(1);
    while (run.length && tokens[run[run.length - 1]].kind === "wop") run = run.slice(0, -1);
    const kinds = run.map((i) => tokens[i].kind);
    const strong = kinds.some((k) => k === "op" || k === "expr") || (kinds.includes("func") && kinds.length > 1);
    if (strong && kinds.some((k) => k !== "op")) {
      let start = tokens[run[0]].start, end = tokens[run[run.length - 1]].end;
      // A bracket opened or closed outside the stretch stays outside.
      while ("([".includes(text[start]) && balance(text.slice(start, end)) > 0) start++;
      while (")]".includes(text[end - 1]) && balance(text.slice(start, end)) < 0) end--;
      spans.push([start, end]);
    }
    run = [];
  };
  tokens.forEach((t, i) => {
    const near = [beside(i, i - 1), beside(i, i + 1)];
    let mathy = t.kind !== "word";
    if (t.kind === "var" && STOP.has(t.inner)) mathy = near.includes("op") || near.includes("wop");
    else if (t.kind === "ident") mathy = near.includes("op");
    if (run.length && !near[0]) close(); // punctuation or a line break before this token
    if (mathy) run.push(i);
    else close();
    // "(g·mol⁻¹) Mn = 55": what follows a bracketed group is another matter, unless an
    // operator joins them.
    if (run.length && t.inner.startsWith("(") && t.inner.endsWith(")") && near[1] !== "op" && near[1] !== "wop") close();
  });
  close();
  return spans;
}

const unbracket = (group) => (group.startsWith("(") && group.endsWith(")") ? group.slice(1, -1) : group);

// A stretch of math, as text, to LaTeX: "10⁶" -> "10^{6}", "tg x" -> "\operatorname{tg} x".
export function latexify(piece) {
  return latexEscape(piece)
    .replace(WORD, nameOf)
    .replace(ROOT, (_, a) => `\\sqrt{${unbracket(a)}}`)
    .replace(SUP_RUN, (run) => `^{${[...run].map((c) => SUP.get(c)).join("")}}`)
    .replace(SUB_RUN, (run) => `_{${[...run].map((c) => SUB.get(c)).join("")}}`)
    .replace(/([\^_])\(([^()]*)\)/g, "$1{$2}")
    .replace(/(?<=[0-9]),(?=[0-9])/g, "{,}")
    .replace(/ +/g, " ")
    .trim();
}

// `text` with each stretch of math written as `$…$`.
export function inlineLatex(text) {
  let out = "", at = 0;
  for (const [start, end] of mathSpans(text)) {
    out += text.slice(at, start) + "$" + latexify(text.slice(start, end)) + "$";
    at = end;
  }
  return out + text.slice(at);
}

// A raised or lowered run as text: "2" -> "²" when every character has that form, else "^(…)".
// In an index, the state of matter is written plainly: "2(g)" -> "₂(g)".
export function scriptText(core, up) {
  const from = up ? SUP_FROM : SUB_FROM, to = [...(up ? SUP_TO : SUB_TO)];
  const convert = (t) => ([...t].every((c) => from.includes(c)) ? [...t].map((c) => to[from.indexOf(c)]).join("") : null);
  const state = up ? null : /\((s|l|ℓ|g|aq|v|c)\)$/.exec(core);
  if (state) {
    const head = core.slice(0, state.index);
    const lowered = head ? convert(head) : "";
    if (lowered !== null) return lowered + state[0];
  }
  const chars = [...core];
  if (chars.length && convert(core) !== null) return convert(core);
  return (up ? "^" : "_") + (chars.length === 1 ? core : `(${core})`);
}
