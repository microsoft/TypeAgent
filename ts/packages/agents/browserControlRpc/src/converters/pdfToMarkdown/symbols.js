// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) 2026 Beatriz Almeida.
// Licensed under the MIT License; see LICENSE.
// Upstream source: https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/symbols.js
// TypeAgent modifications: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Adapted source and provenance header; reversible patch recorded in ts/tools/scripts/converters/pdfToMarkdown/patches.
// Symbol tables shared by the layout engine and the inline-math writer — the browser side of
// src/papero_extract/symbols.py. Keep both in sync.

export const GREEK = {
  "α": "\\alpha", "β": "\\beta", "γ": "\\gamma", "δ": "\\delta", "ε": "\\epsilon", "ϵ": "\\epsilon",
  "ζ": "\\zeta", "η": "\\eta", "θ": "\\theta", "ϑ": "\\vartheta", "ι": "\\iota", "κ": "\\kappa",
  "λ": "\\lambda", "μ": "\\mu", "ν": "\\nu", "ξ": "\\xi", "π": "\\pi", "ϖ": "\\varpi", "ρ": "\\rho",
  "σ": "\\sigma", "ς": "\\varsigma", "τ": "\\tau", "υ": "\\upsilon", "φ": "\\phi", "ϕ": "\\phi",
  "χ": "\\chi", "ψ": "\\psi", "ω": "\\omega", "Γ": "\\Gamma", "Δ": "\\Delta", "Θ": "\\Theta",
  "Λ": "\\Lambda", "Ξ": "\\Xi", "Π": "\\Pi", "Σ": "\\Sigma", "Υ": "\\Upsilon", "Φ": "\\Phi",
  "Ψ": "\\Psi", "Ω": "\\Omega",
};
export const OPERATORS = {
  "∑": "\\sum", "∏": "\\prod", "∐": "\\coprod", "∫": "\\int", "∬": "\\iint", "∭": "\\iiint",
  "∮": "\\oint", "√": "\\sqrt", "∂": "\\partial", "∇": "\\nabla", "∞": "\\infty", "±": "\\pm",
  "∓": "\\mp", "×": "\\times", "÷": "\\div", "·": "\\cdot", "⋅": "\\cdot", "∘": "\\circ",
  "≤": "\\leq", "≥": "\\geq", "≠": "\\neq", "≈": "\\approx", "≡": "\\equiv", "≅": "\\cong",
  "∼": "\\sim", "∝": "\\propto", "≪": "\\ll", "≫": "\\gg", "∈": "\\in", "∉": "\\notin", "∋": "\\ni",
  "⊂": "\\subset", "⊃": "\\supset", "⊆": "\\subseteq", "⊇": "\\supseteq", "∪": "\\cup", "∩": "\\cap",
  "∅": "\\emptyset", "∀": "\\forall", "∃": "\\exists", "∄": "\\nexists", "¬": "\\neg", "∧": "\\wedge",
  "∨": "\\vee", "⊕": "\\oplus", "⊗": "\\otimes", "→": "\\to", "←": "\\leftarrow",
  "↔": "\\leftrightarrow", "⇒": "\\Rightarrow", "⇐": "\\Leftarrow", "⇔": "\\Leftrightarrow",
  "↦": "\\mapsto", "ℝ": "\\mathbb{R}", "ℕ": "\\mathbb{N}", "ℤ": "\\mathbb{Z}", "ℚ": "\\mathbb{Q}",
  "ℂ": "\\mathbb{C}", "ℓ": "\\ell", "ℏ": "\\hbar", "′": "'", "″": "''", "−": "-", "∗": "*",
  "…": "\\ldots", "⋯": "\\cdots", "⌊": "\\lfloor", "⌋": "\\rfloor", "⌈": "\\lceil", "⌉": "\\rceil",
  "⟨": "\\langle", "⟩": "\\rangle", "‖": "\\|", "°": "^{\\circ}",
};
export const LATEX = { ...GREEK, ...OPERATORS };
export const SUP_FROM = "0123456789+-=()niabcdehijklmoprstuvwxyz";
export const SUP_TO = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾ⁿⁱᵃᵇᶜᵈᵉʰⁱʲᵏˡᵐᵒᵖʳˢᵗᵘᵛʷˣʸᶻ";
export const SUB_FROM = "0123456789+-=()aehijklmnoprstuvx";
export const SUB_TO = "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ";

export function latexEscape(text) {
  let out = "";
  for (const ch of text) {
    if (LATEX[ch]) out += LATEX[ch] + (/[a-zA-Z]$/.test(LATEX[ch]) ? " " : "");
    else if ("{}%#&$".includes(ch)) out += "\\" + ch;
    else out += ch;
  }
  return out.replace(/ {2}/g, " ");
}
