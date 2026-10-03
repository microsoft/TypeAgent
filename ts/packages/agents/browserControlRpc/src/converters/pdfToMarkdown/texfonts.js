// Copyright (c) 2026 Beatriz Almeida.
// Licensed under the MIT License; see LICENSE.
// Upstream source: https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/texfonts.js
// TypeAgent modifications: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Adapted source and provenance header; reversible patch recorded in ts/tools/scripts/converters/pdfToMarkdown/patches.
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) 2026 Beatriz Almeida.
// Licensed under the MIT License; see LICENSE.
// Upstream source: https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/texfonts.js
// TypeAgent modifications: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Adapted source and provenance header; reversible patch recorded in ts/tools/scripts/converters/pdfToMarkdown/patches.
// TeX math fonts without a ToUnicode map — the browser side of src/papero_extract/tex_fonts.py.
//
// A paper set in Computer Modern often ships no ToUnicode table, so a reader sees raw glyph
// codes: "ϵ" comes out as control character 0x0F, "≠" as "6=", "⟨x, y⟩" as "hx, yi".
// Two ways back to the symbol:
//   1. the glyph's PostScript name, when the PDF lists it ("circledot" -> "⊙"). This always
//      holds, even when the producer renumbered the glyphs of a subset font (IEEE Xplore);
//   2. TeX's font encodings (OML, OMS, OMX), valid only when TeX itself wrote the PDF.

export const NOT = String.fromCharCode(0x338); // combining slash: TeX draws "≠" as a slash, then "="
const pairs = (from, to) => Object.fromEntries([...from].map((c, i) => [c, [...to][i]]));
export const NEGATED = pairs("=∈∋≡∼≃≈⊂⊃⊆⊇<>≤≥∃|‖→←⇒⇔≺≻", "≠∉∌≢≁≄≉⊄⊅⊈⊉≮≯≰≱∄∤∦↛↚⇏⇎⊀⊁");

export const isTexProducer = (producer) => /pdftex|luatex|xetex|dvips|dvipdfm/i.test(producer || "");

// ------------------------------------------------------------------ by glyph name
const NAMES = {
  // cmsy
  minus: "−", periodcentered: "·", multiply: "×", asteriskmath: "∗", divide: "÷", diamondmath: "⋄",
  plusminus: "±", minusplus: "∓", circleplus: "⊕", circleminus: "⊖", circlemultiply: "⊗",
  circledivide: "⊘", circledot: "⊙", circlecopyrt: "○", openbullet: "∘", bullet: "•",
  equivasymptotic: "≍", equivalence: "≡", reflexsubset: "⊆", reflexsuperset: "⊇", lessequal: "≤",
  greaterequal: "≥", precedesequal: "⪯", followsequal: "⪰", similar: "∼", approxequal: "≈",
  propersubset: "⊂", propersuperset: "⊃", lessmuch: "≪", greatermuch: "≫", precedes: "≺", follows: "≻",
  arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓", arrowboth: "↔", arrownortheast: "↗",
  arrowsoutheast: "↘", similarequal: "≃", arrowdblleft: "⇐", arrowdblright: "⇒", arrowdblup: "⇑",
  arrowdbldown: "⇓", arrowdblboth: "⇔", arrownorthwest: "↖", arrowsouthwest: "↙", proportional: "∝",
  prime: "′", infinity: "∞", element: "∈", owner: "∋", triangle: "△", triangleinv: "▽",
  negationslash: NOT, mapsto: "", universal: "∀", existential: "∃", logicalnot: "¬", emptyset: "∅",
  Rfractur: "ℜ", Ifractur: "ℑ", latticetop: "⊤", perpendicular: "⊥", aleph: "ℵ", union: "∪",
  intersection: "∩", unionmulti: "⊎", logicaland: "∧", logicalor: "∨", turnstileleft: "⊢",
  turnstileright: "⊣", floorleft: "⌊", floorright: "⌋", ceilingleft: "⌈", ceilingright: "⌉",
  angbracketleft: "⟨", angbracketright: "⟩", bardbl: "‖", arrowbothv: "↕", arrowdblbothv: "⇕",
  wreathproduct: "≀", radical: "√", coproduct: "⨿", nabla: "∇", integral: "∫", unionsq: "⊔",
  intersectionsq: "⊓", subsetsqequal: "⊑", supersetsqequal: "⊒", dagger: "†", daggerdbl: "‡",
  club: "♣", diamond: "♢", heart: "♡", spade: "♠",
  // cmmi
  epsilon1: "ϵ", theta1: "ϑ", pi1: "ϖ", rho1: "ϱ", sigma1: "ς", phi1: "ϕ", harpoonleftup: "↼",
  harpoonleftdown: "↽", harpoonrightup: "⇀", harpoonrightdown: "⇁", triangleright: "▷",
  triangleleft: "◁", star: "⋆", partialdiff: "∂", flat: "♭", natural: "♮", sharp: "♯",
  slurbelow: "⌣", slurabove: "⌢", lscript: "ℓ", dotlessj: "ȷ", weierstrass: "℘", vector: "", tie: "",
  // cmex: delimiters built from pieces
  vextendsingle: "|", vextenddouble: "‖", parenlefttp: "⎛", parenleftbt: "⎝", parenleftex: "⎜",
  parenrighttp: "⎞", parenrightbt: "⎠", parenrightex: "⎟", bracketlefttp: "⎡", bracketleftbt: "⎣",
  bracketleftex: "⎢", bracketrighttp: "⎤", bracketrightbt: "⎦", bracketrightex: "⎥",
  bracelefttp: "⎧", braceleftmid: "⎨", braceleftbt: "⎩", braceex: "⎪", bracerighttp: "⎫",
  bracerightmid: "⎬", bracerightbt: "⎭", radicalbt: "√",
};
// Pieces that only draw: horizontal braces, arrow shafts, the top of a radical.
const SILENT = /^(brace(left|right)(down|up)|bracehtip(down|up)(left|right)|arrow(dbl)?(vertex|tp|bt)(dbl)?|radical(vertex|tp)|hatwid(e|er|est)|tildewid(e|er|est)|mapstochar)$/;
// "parenleftbigg", "summationdisplay": a size variant of a plain glyph.
const SIZED = /^(.+?)(big|Big|bigg|Bigg|text|display)\d?$/;
const BASE = {
  parenleft: "(", parenright: ")", bracketleft: "[", bracketright: "]", braceleft: "{", braceright: "}",
  slash: "/", backslash: "\\", floorleft: "⌊", floorright: "⌋", ceilingleft: "⌈", ceilingright: "⌉",
  angbracketleft: "⟨", angbracketright: "⟩", summation: "∑", product: "∏", integral: "∫", union: "⋃",
  intersection: "⋂", unionmulti: "⊎", logicaland: "⋀", logicalor: "⋁", coproduct: "∐",
  contintegral: "∮", circledot: "⊙", circleplus: "⊕", circlemultiply: "⊗", unionsq: "⊔", radical: "√",
};

// The symbol a TeX glyph name stands for; "" for a glyph that carries no text; undefined
// when the name says nothing special (pdf.js's own mapping stands).
export function texGlyph(name) {
  if (!name) return undefined;
  if (Object.hasOwn(NAMES, name)) return NAMES[name];
  if (SILENT.test(name)) return "";
  const m = SIZED.exec(name);
  return m && Object.hasOwn(BASE, m[1]) ? BASE[m[1]] : undefined;
}

// ------------------------------------------------------------------ by character code
const table = (...rows) => {
  const out = {};
  for (const [start, glyphs] of rows) [...glyphs].forEach((g, k) => { out[start + k] = g; });
  return out;
};
const GREEK_CAPS = "ΓΔΘΛΞΠΣΥΦΨΩ";
const OML = table(
  [0x00, GREEK_CAPS + "αβγδϵζηθικλμνξπρστυϕχψωεϑϖϱςφ"],
  [0x28, ["↼", "↽", "⇀", "⇁", "", "", "▷", "◁"]],
  [0x3a, [".", ",", "<", "/", ">", "⋆", "∂"]],
  [0x5b, ["♭", "♮", "♯", "⌣", "⌢", "ℓ"]],
  [0x7b, ["ı", "ȷ", "℘", "", ""]],
);
const OMS = table(
  [0x00, "−·×∗÷⋄±∓⊕⊖⊗⊘⊙○∘•"],
  [0x10, "≍≡⊆⊇≤≥⪯⪰∼≈⊂⊃≪≫≺≻"],
  [0x20, "←→↑↓↔↗↘≃⇐⇒⇑⇓⇔↖↙∝"],
  [0x30, ["′", "∞", "∈", "∋", "△", "▽", NOT, "", "∀", "∃", "¬", "∅", "ℜ", "ℑ", "⊤", "⊥", "ℵ"]],
  [0x5b, "∪∩⊎∧∨"],
  [0x60, "⊢⊣⌊⌋⌈⌉{}⟨⟩|‖↕⇕\\≀"],
  [0x70, "√⨿∇∫⊔⊓⊑⊒§†‡¶♣♢♡♠"],
);
const OMX = table(
  [0x00, "()[]⌊⌋⌈⌉{}⟨⟩|‖/\\"],
  [0x10, "()()[]⌊⌋⌈⌉{}⟨⟩/\\"],
  [0x20, "()[]⌊⌋⌈⌉{}⟨⟩/\\/\\"],
  [0x30, ["⎛", "⎞", "⎡", "⎤", "⎣", "⎦", "⎢", "⎥", "⎧", "⎫", "⎩", "⎭", "⎨", "⎬", "⎪", ""]],
  [0x40, "⎝⎠⎜⎟⟨⟩⊔⊔∮∮⊙⊙⊕⊕⊗⊗"],
  [0x50, "∑∏∫⋃⋂⊎⋀⋁∑∏∫⋃⋂⊎⋀⋁"],
  [0x60, ["∐", "∐", "", "", "", "", "", "", "[", "]", "⌊", "⌋", "⌈", "⌉", "{", "}"]],
  [0x70, ["√", "√", "√", "√", "√", "", "", "", "", "", "", "", "", "", "", ""]],
);
const ENCODINGS = { oml: OML, oms: OMS, omx: OMX };
const FAMILY = [[/^(cmmi|cmmib|lmmi|lmmathitalic)/, "oml"], [/^(cmsy|cmbsy|lmsy|lmmathsymbols)/, "oms"], [/^(cmex|lmex|lmmathextension)/, "omx"]];

// "ABCDEF+CMSY10" -> "oms"; "" for a font that is not one of TeX's.
export function texEncoding(fontName) {
  const base = (fontName || "").split("+").pop().toLowerCase();
  for (const [re, enc] of FAMILY) if (re.test(base)) return enc;
  return "";
}

// The symbol behind a raw code. Every code of these fonts is a symbol, so this is used
// only for a glyph that came through unmapped (as its own code).
export function texChar(code, encoding) {
  const g = ENCODINGS[encoding]?.[code];
  return g === undefined ? undefined : g;
}
