// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) 2026 Beatriz Almeida.
// Licensed under the MIT License; see LICENSE.
// Upstream source: https://github.com/beatrizalmeidaf/papero-pdf-text-extractor/blob/f9e92cbc0224d1413c11dda15b284ee41b9fc48f/web/assets/export.js
// TypeAgent modifications: Copyright (c) Microsoft Corporation. Licensed under the MIT License.
// Adapted source and provenance header; reversible patch recorded in ts/tools/scripts/converters/pdfToMarkdown/patches.
import { inlineLatex, latexify, mathSpans, scriptText } from "./mathtext.js";


const FURNITURE = new Set(["header", "footer", "page_number"]);
 // lets Notepad/Excel detect UTF-8 (accents)
const BULLET_CHARS = "•◦▪▫‣⁃●○■□–—*✓✔➢➤►▶·-";


export const contentBlocks = (page) => page.blocks.filter((b) => !FURNITURE.has(b.type));


// ---------------------------------------------------------------- markdown
const mdCell = (t) => String(t).replace(/\|/g, "\\|").replace(/\n/g, "<br>").trim();

export function mdTable(rows) {
  const width = Math.max(...rows.map((r) => r.length));
  const full = rows.map((r) => [...r, ...Array(width - r.length).fill("")]);
  return [
    "| " + full[0].map(mdCell).join(" | ") + " |",
    "|" + Array(width).fill("---").join("|") + "|",
    ...full.slice(1).map((r) => "| " + r.map(mdCell).join(" | ") + " |"),
  ].join("\n");
}

function imageMd(b, images, alt) {
  if (!b.image || images === "none") return null;
  if (images === "embed" && b.image.data) return `![${alt}](data:${b.image.mime};base64,${b.image.data})`;
  return `![${alt}](images/${b.image.name})`;
}

// Words printed inside a figure (legend, axis titles) help search; bare tick values don't.
export function figureWords(text) {
  return text
    .split("\n")
    .map((ln) => ln.split(/\s+/).filter((t) => t && !/^[-+−]?[\d.,%]+$/.test(t)).join(" "))
    .filter((ln) => /\p{L}/u.test(ln));
}

function splitOuterWhitespace(text) {
  let start = 0;
  while (start < text.length && /\s/.test(text[start])) start++;
  let end = text.length;
  while (end > start && /\s/.test(text[end - 1])) end--;
  return [text.slice(0, start), text.slice(start, end), text.slice(end)];
}

// Inline formatting as Markdown: **bold**, *italic*, <sup>/<sub>; markers hug the words.
// **bold** / *italic* around the words, the spaces at either end left outside.
function emphasis(text, bold, italic) {
  const [lead, core, trail] = splitOuterWhitespace(text);
  if (!core) return text;
  let t = core;
  if (italic) t = `*${t}*`;
  if (bold) t = `**${t}**`;
  return lead + t + trail;
}

function mdInline(b, math = "unicode") {
  if (math === "latex") return mdInlineLatex(b);
  if (!b.runs?.length) return (b.text || "").replace(/\n/g, "  \n");
  return b.runs.map((r) => {
    const [lead, core, trail] = splitOuterWhitespace(r.text);
    if (!core) return r.text;
    let t = core.replace(/\*/g, "\\*");
    if (r.script) t = r.script === "super" ? `<sup>${t}</sup>` : `<sub>${t}</sub>`;
    return lead + emphasis(t, r.bold, r.italic) + trail;
  }).join("").replace(/\n/g, "  \n");
}

// The block with its math as `$…$` (exponents and indices inside it), bold and italic kept on
// the words around.
function mdInlineLatex(b) {
  let text = "";
  const looks = []; // "bold,italic" of each character
  for (const r of b.runs?.length ? b.runs : [{ text: b.text || "" }]) {
    let t = r.text;
    if (r.script) t = scriptText(t.trim(), r.script === "super") + (/\s$/.test(t) ? " " : "");
    text += t;
    for (let k = 0; k < t.length; k++) looks.push(`${!!r.bold},${!!r.italic}`);
  }
  const plain = (start, end) => {
    let out = "", at = start;
    for (let k = start; k <= end; k++) {
      if (k === end || looks[k] !== looks[at]) {
        if (at < k) {
          const piece = text.slice(at, k).replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/\$/g, "\\$");
          out += emphasis(piece, looks[at].startsWith("true"), looks[at].endsWith("true"));
        }
        at = k;
      }
    }
    return out;
  };
  let out = "", at = 0;
  for (const [start, end] of mathSpans(text)) {
    out += plain(at, start) + "$" + latexify(text.slice(start, end)) + "$";
    at = end;
  }
  return (out + plain(at, text.length)).replace(/\n/g, "  \n");
}

export function blockMarkdown(b, images = "ref", math = "unicode") {
  const text = math === "latex" ? inlineLatex(b.text || "") : b.text;
  switch (b.type) {
    case "heading":
      return "#".repeat(Math.min(6, Math.max(1, b.level || 2))) + " " + text.replace(/\n/g, " ");
    case "list_item": {
      let marker = b.marker || "-";
      if (BULLET_CHARS.includes(marker[0])) marker = "-";
      return "  ".repeat(b.level || 0) + `${marker} ${mdInline(b, math)}`;
    }
    case "table":
      return b.rows ? mdTable(b.rows) : b.text;
    case "formula": {
      const tag = b.number ? ` \\tag{${b.number.replace(/[()]/g, "")}}` : "";
      return `$$\n${b.latex || b.text}${tag}\n$$`;
    }
    case "figure": {
      const alt = (b.caption || "figura").replace(/]/g, ")").replace(/\n/g, " ").slice(0, 120);
      let out = imageMd(b, images, alt) || `<!-- figura: ${alt} -->`;
      const words = figureWords(b.text || "");
      if (words.length) out += "\n\n" + words.map((l) => `> ${l}`).join("\n");
      return out;
    }
    case "caption":
      return `*${text}*`;
    case "code":
      return "```\n" + b.text + "\n```";
    default:
      return mdInline(b, math);
  }
}

export function toMarkdown(doc, { images = "ref", pageBreaks = false, math = "unicode" } = {}) {
  const out = [];
  doc.pages.forEach((page) => {
    if (pageBreaks && out.length) out.push(`<!-- página ${page.number} -->`);
    let prev = null;
    for (const b of contentBlocks(page)) {
      const md = blockMarkdown(b, images, math);
      if (!md.trim()) continue;
      // Consecutive list items stay tight. "a) …" is not a list to Markdown, which would run
      // such lines together: they end in a hard break.
      if (prev && prev.type === "list_item" && b.type === "list_item" && out.length) out[out.length - 1] += (/^\s*(-|[0-9]+[.)]) /.test(md) ? "\n" : "  \n") + md;
      else out.push(md);
      prev = b;
    }
  });
  return out.join("\n\n").trim() + "\n";
}
