/**
 * Summary is a script: it writes summary.pdf, one landscape page listing
 * every interface with its extends clause, a one-line description, and each
 * member's typed signature with a one-line description. Inherited members
 * are not repeated; the extends clause in each heading says where they come
 * from.
 *
 * How: takes the parsed interfaces from catalog.ts (without running tests),
 * flows them into three columns, and picks the largest font size at which
 * everything fits on the page. Writes the PDF directly, using the standard
 * Helvetica and Courier fonts, which PDF readers supply, so nothing is
 * embedded and no library is needed.
 * Run: npm run summary.
 * Imports: node:fs, catalog.ts
 */

import { writeFileSync } from "node:fs";
import { build, type Interface } from "./catalog.ts";

type Font = "H" | "HB" | "HO" | "C";
type RGB = readonly [number, number, number];

const fontNames: Record<Font, string> = { H: "Helvetica", HB: "Helvetica-Bold", HO: "Helvetica-Oblique", C: "Courier" };

const ink: RGB = [0.11, 0.13, 0.18];
const accent: RGB = [0.13, 0.36, 0.56];
const muted: RGB = [0.36, 0.39, 0.45];
const hairline: RGB = [0.8, 0.82, 0.86];

// Glyph widths in thousandths of an em, for ASCII 32-126 (from the fonts' AFM files).
const helvetica = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
  556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const helveticaBold = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611,
  611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

/** Characters outside ASCII that WinAnsiEncoding has: their code and width. */
const winAnsi: Record<string, [number, number]> = {
  "×": [0xd7, 584], "±": [0xb1, 584], "–": [0x96, 556], "—": [0x97, 1000], "‘": [0x91, 222], "’": [0x92, 222],
  "“": [0x93, 333], "”": [0x94, 333], "…": [0x85, 1000], "·": [0xb7, 278], "≤": [0x3c, 584], "≥": [0x3e, 584],
};

function width(text: string, font: Font, size: number): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    w += font === "C" ? 600 : 32 <= c && c <= 126 ? (font === "HB" ? helveticaBold : helvetica)[c - 32] : winAnsi[ch]?.[1] ?? 556;
  }
  return (w * size) / 1000;
}

/** Text as a PDF string literal, in WinAnsiEncoding. */
function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    const code = 32 <= c && c <= 126 ? c : winAnsi[ch]?.[0] ?? 0x3f;
    const s = String.fromCharCode(code);
    out += s === "(" || s === ")" || s === "\\" ? "\\" + s : s;
  }
  return `(${out})`;
}

// ---- Text flow --------------------------------------------------------------

interface Seg { font: Font; size: number; color: RGB; text: string }
interface Placed extends Seg { x: number }
interface Line { height: number; segs: Placed[] }

/** Breaks segments into lines at spaces. Continuation lines start at hang. */
function flow(segs: readonly Seg[], maxWidth: number, indent = 0, hang = indent): Line[] {
  const lines: Line[] = [];
  let line: Placed[] = [];
  let x = indent;
  let space = 0;
  const finish = () => {
    lines.push({ height: Math.max(...line.map((s) => s.size)) * 1.2, segs: line });
    line = [];
  };
  for (const seg of segs) {
    for (const token of seg.text.match(/\s+|\S+/g) ?? []) {
      if (/^\s/.test(token)) {
        if (line.length > 0) space += width(" ", seg.font, seg.size);
        continue;
      }
      const w = width(token, seg.font, seg.size);
      if (line.length > 0 && x + space + w > maxWidth) {
        finish();
        x = hang;
        space = 0;
      }
      const last = line[line.length - 1];
      if (last && last.font === seg.font && last.size === seg.size && last.color === seg.color && space > 0) {
        last.text += " " + token;
      } else if (last && last.font === seg.font && last.size === seg.size && last.color === seg.color) {
        last.text += token;
      } else {
        line.push({ ...seg, x: x + space, text: token });
      }
      x += space + w;
      space = 0;
    }
  }
  if (line.length > 0) finish();
  return lines;
}

// ---- Content ---------------------------------------------------------------

/** The first sentence of a doc comment's prose. */
function firstSentence(doc: string): string {
  const para = doc.split("\n\n")[0] ?? "";
  return /^(.*?[.!?])(?=\s+[A-Z(]|$)/s.exec(para)?.[1] ?? para;
}

/** Type parameters without their defaults: <S extends Shape = Shape> becomes <S extends Shape>. */
function condensed(typeParams: string): string {
  return typeParams.replace(/\s*=\s*[^,>]+/g, "");
}

/** A run of lines placed together. A unit marked keep stays in the same column as the next one. */
interface Unit { lines: Line[]; keep: boolean; startsInterface: boolean; owner: string }

function units(all: readonly Interface[], size: number, colWidth: number): Unit[] {
  const small = size * 0.9;
  const out: Unit[] = [];
  let file = "";
  for (const i of all) {
    if (i.file !== file) {
      file = i.file;
      out.push({ lines: flow([{ font: "HB", size: small, color: accent, text: file.toUpperCase() }], colWidth), keep: true, startsInterface: true, owner: "" });
    }
    const head: Seg[] = [{ font: "HB", size: size * 1.12, color: ink, text: i.name }];
    if (i.typeParams) head.push({ font: "C", size, color: ink, text: condensed(i.typeParams) });
    if (i.extendsClause) {
      head.push({ font: "H", size, color: accent, text: " extends " }, { font: "C", size, color: accent, text: i.extendsClause });
    }
    const lines = flow(head, colWidth, 0, size * 1.5);
    if (i.doc) lines.push(...flow([{ font: "HO", size: small, color: muted, text: firstSentence(i.doc) }], colWidth));
    out.push({ lines, keep: i.members.length > 0, startsInterface: true, owner: i.name });
    for (const m of i.members) {
      const member = flow([{ font: "C", size, color: ink, text: m.signature }], colWidth, size * 0.6, size * 2.4);
      if (m.doc) member.push(...flow([{ font: "H", size: small, color: muted, text: firstSentence(m.doc) }], colWidth, size * 1.8));
      out.push({ lines: member, keep: false, startsInterface: false, owner: i.name });
    }
  }
  return out;
}

// ---- Page ------------------------------------------------------------------

const pageW = 792;
const pageH = 612;
const margin = 30;
const columns = 3;
const gutter = 18;
const colWidth = (pageW - 2 * margin - (columns - 1) * gutter) / columns;

interface PlacedLine { col: number; y: number; line: Line }

/** Lays the units out in columns below top, or returns null if they don't fit. */
function layout(all: readonly Interface[], size: number, top: number): { lines: PlacedLine[]; rules: { col: number; y: number }[] } | null {
  const us = units(all, size, colWidth);
  const height = pageH - margin - top;
  const placed: PlacedLine[] = [];
  const rules: { col: number; y: number }[] = [];
  const h = (u: Unit) => u.lines.reduce((t, l) => t + l.height, 0);
  let col = 0;
  let y = 0;
  for (let k = 0; k < us.length; k++) {
    const u = us[k];
    const gap = u.startsInterface && y > 0 && us[k - 1]?.owner !== "" ? size * 0.8 : 0;
    let need = gap + h(u);
    for (let j = k; us[j]?.keep && j + 1 < us.length; j++) need += h(us[j + 1]);
    let continued = false;
    if (y + need > height && y > 0) {
      col++;
      y = 0;
      continued = !u.startsInterface;
      if (col >= columns) return null;
    } else {
      y += gap;
      if (gap > 0) rules.push({ col, y: y - size * 0.45 });
    }
    if (continued) {
      const line = flow([{ font: "HB", size: size * 0.9, color: muted, text: `${u.owner}, continued` }], colWidth)[0];
      placed.push({ col, y, line });
      y += line.height;
    }
    for (const line of u.lines) {
      placed.push({ col, y, line });
      y += line.height;
    }
  }
  return { lines: placed, rules };
}

function render(all: readonly Interface[], date: string): string {
  const ops: string[] = [];
  const text = (seg: Seg, x: number, baseline: number) =>
    ops.push(`BT /${seg.font} ${seg.size.toFixed(2)} Tf ${seg.color.join(" ")} rg 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm ${pdfString(seg.text)} Tj ET`);
  const rule = (x1: number, x2: number, y: number) =>
    ops.push(`${hairline.join(" ")} RG 0.5 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);

  // Heading: title, provenance, and every extends relationship in one line.
  const files = [...new Set(all.map((i) => i.file))];
  const title = flow([
    { font: "HB", size: 14, color: ink, text: "Interface summary" },
    { font: "H", size: 8, color: muted, text: `   ${all.length} interfaces in ${files.join(", ")}. Generated ${date} by npm run summary. Inherited members are listed under the interface that declares them.` },
  ], pageW - 2 * margin);
  const relations = all.filter((i) => i.extends.length > 0);
  const extendsSegs: Seg[] = [{ font: "HB", size: 7.5, color: accent, text: "Extends   " }];
  relations.forEach((i, n) => {
    extendsSegs.push(
      { font: "HB", size: 7.5, color: ink, text: (n > 0 ? "   ·   " : "") + i.name },
      { font: "H", size: 7.5, color: muted, text: " extends " },
      { font: "H", size: 7.5, color: ink, text: i.extends.join(", ") },
    );
  });
  const heading = [...title, ...flow(extendsSegs, pageW - 2 * margin)];
  let y = margin;
  for (const line of heading) {
    for (const s of line.segs) text(s, margin + s.x, pageH - y - line.height * 0.8);
    y += line.height;
  }
  rule(margin, pageW - margin, pageH - y - 4);
  const top = y + 14;

  let size = 10;
  let result = layout(all, size, top);
  while (!result && size > 4) {
    size -= 0.1;
    result = layout(all, size, top);
  }
  if (!result) throw new Error("the interfaces don't fit on one page, even at 4 pt");
  for (const { col, y: ly, line } of result.lines) {
    const x0 = margin + col * (colWidth + gutter);
    for (const s of line.segs) text(s, x0 + s.x, pageH - top - ly - line.height * 0.8);
  }
  for (const r of result.rules) {
    const x0 = margin + r.col * (colWidth + gutter);
    rule(x0, x0 + colWidth, pageH - top - r.y);
  }
  console.log(`summary.pdf: ${all.length} interfaces at ${size.toFixed(1)} pt`);
  return ops.join("\n");
}

/** A one-page PDF with the given content stream and the four standard fonts it uses. */
function pdf(content: string): Buffer {
  const fonts = Object.entries(fontNames);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents 4 0 R /Resources << /Font << ${
      fonts.map(([key], n) => `/${key} ${5 + n} 0 R`).join(" ")} >> >> >>`,
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    ...fonts.map(([, name]) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`),
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, n) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${n + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

// Interfaces only: a file's header rules have no members to list.
const all = build(new Set()).filter((i) => !i.module);
writeFileSync("summary.pdf", pdf(render(all, new Date().toLocaleDateString("en-CA"))));
