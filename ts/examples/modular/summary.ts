/**
 * Summary is a script: it writes summary.pdf, landscape pages listing every
 * interface with its extends clause, its file, a one-line description, the
 * interfaces it extends and those that extend or use it (with their pages), and
 * each member's typed signature with a one-line description. Each group
 * ends with the type aliases its interfaces mention (EventMap, ItemId and
 * so on), each listed once, with what uses it. Inherited
 * members are not repeated; the extends clause in each heading says where
 * they come from. No text is smaller than 10 pt; the summary takes as many
 * pages as that needs.
 *
 * How: takes the parsed interfaces from catalog.ts (without running tests)
 * and groups them by their extends and uses edges. Each edge is weighted
 * (extends counts more than uses) and divided by how connected both ends
 * are, so a type that everything uses, such as Point, doesn't pull every
 * group together. Groups merge, most related first, while the merged group
 * still fits on a page. Within a group and between groups, an interface
 * comes after the interfaces it extends or uses, where the edges allow.
 * Each alias goes in the group of the first interface that mentions it,
 * preferring its own file. Groups are packed onto pages in that order, and each group's heading
 * lists the interfaces it refers to on other pages. Writes the PDF
 * directly, using the standard Helvetica and Courier fonts, which PDF
 * readers supply, so nothing is embedded and no library is needed.
 * Run: npm run summary.
 * Imports: node:fs, catalog.ts
 */

import { writeFileSync } from "node:fs";
import { build, typeAliases, type Interface, type TypeAlias } from "./catalog.ts";

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

/** The smallest type on any page: signatures, descriptions and labels. */
const size = 10;
const nameSize = 12;

/** The first sentence of a doc comment's prose. */
function firstSentence(doc: string): string {
  const para = doc.split("\n\n")[0] ?? "";
  return /^(.*?[.!?])(?=\s+[A-Z(]|$)/s.exec(para)?.[1] ?? para;
}

/** Type parameters without their defaults: <S extends Shape = Shape> becomes <S extends Shape>. */
function condensed(typeParams: string): string {
  return typeParams.replace(/\s*=\s*[^,>]+/g, "");
}

/**
 * A run of lines placed together. A unit marked keep stays in the same column
 * as the next one. A group's heading unit has owner "".
 */
interface Unit { lines: Line[]; keep: boolean; startsInterface: boolean; owner: string }

/**
 * Where interfaces and types are: pageOf gives one's page, usedBy the
 * interfaces and types that extend or use one, and typesOf the type aliases
 * an interface mentions.
 */
interface Refs { pageOf: (name: string) => string; usedBy: Map<string, string[]>; typesOf: (i: Interface) => string[] }

/** Names grouped by page: "A, B (page 1); C (page 3)". Names on page here get no page number. */
function onPages(names: readonly string[], refs: Refs, here = ""): string {
  const byPage = new Map<string, string[]>();
  for (const n of names) byPage.set(refs.pageOf(n), [...(byPage.get(refs.pageOf(n)) ?? []), n]);
  return [...byPage]
    .sort(([a], [b]) => (a === here ? -1 : b === here ? 1 : Number(a) - Number(b)))
    .map(([p, ns]) => (p === here ? ns.join(", ") : `${ns.join(", ")} (page ${p})`))
    .join("; ");
}

function interfaceUnits(i: Interface, refs: Refs): Unit[] {
  const head: Seg[] = [{ font: "HB", size: nameSize, color: ink, text: i.name }];
  if (i.typeParams) head.push({ font: "C", size, color: ink, text: condensed(i.typeParams) });
  if (i.extendsClause) {
    head.push({ font: "H", size, color: accent, text: " extends " }, { font: "C", size, color: accent, text: i.extendsClause });
  }
  head.push({ font: "H", size, color: muted, text: `   ${i.file}` });
  const lines = flow(head, colWidth, 0, size * 1.5);
  if (i.doc) lines.push(...flow([{ font: "HO", size, color: muted, text: firstSentence(i.doc) }], colWidth));
  const here = refs.pageOf(i.name);
  const usedBy = refs.usedBy.get(i.name) ?? [];
  const links: Seg[] = [];
  const link = (label: string, names: readonly string[]) => {
    if (names.length === 0) return;
    links.push({ font: "HB", size, color: accent, text: `${links.length > 0 ? "  " : ""}${label} ` });
    links.push({ font: "H", size, color: ink, text: `${onPages(names, refs, here)}.` });
  };
  link("Extends", i.extends);
  link("Used by", usedBy);
  if (links.length > 0) lines.push(...flow(links, colWidth, 0, size * 1.5));
  const out: Unit[] = [{ lines, keep: i.members.length > 0, startsInterface: true, owner: i.name }];
  for (const m of i.members) {
    const member = flow([{ font: "C", size, color: ink, text: m.signature }], colWidth, size * 0.6, size * 2.4);
    if (m.doc) member.push(...flow([{ font: "H", size, color: muted, text: firstSentence(m.doc) }], colWidth, size * 1.8));
    out.push({ lines: member, keep: false, startsInterface: false, owner: i.name });
  }
  return out;
}

const unitHeight = (u: Unit) => u.lines.reduce((t, l) => t + l.height, 0);

// ---- Groups ----------------------------------------------------------------

/** A group's interfaces, and the type aliases listed with them. */
interface Group { name: string; members: Interface[]; types: TypeAlias[] }

// Chosen by comparing the groups they give for the circles app.
const extendsWeight = 3;
const usesWeight = 1;
/** Ties interfaces with no edges between them, such as App, to their file. */
const sameFileWeight = 0.15;

const refersTo = (a: Interface, b: Interface) => a.extends.includes(b.name) || a.uses.includes(b.name);

/**
 * How related each pair of interfaces is: the weights of the edges between
 * them, in either direction, divided by the product of the two ends'
 * neighbor counts, plus sameFileWeight for two interfaces in one file.
 */
function weights(all: readonly Interface[]): Map<string, Map<string, number>> {
  const raw = new Map(all.map((i) => [i.name, new Map<string, number>()]));
  const add = (a: string, b: string, w: number) => {
    if (a === b || !raw.has(a) || !raw.has(b)) return;
    for (const [x, y] of [[a, b], [b, a]]) raw.get(x)!.set(y, (raw.get(x)!.get(y) ?? 0) + w);
  };
  for (const i of all) {
    for (const e of i.extends) add(i.name, e, extendsWeight);
    for (const u of i.uses) add(i.name, u, usesWeight);
  }
  const degree = (n: string) => raw.get(n)!.size;
  const out = new Map([...raw].map(([a, m]) => [a, new Map([...m].map(([b, w]) => [b, w / (degree(a) * degree(b))]))]));
  for (const a of all) {
    for (const b of all) {
      if (a !== b && a.file === b.file) out.get(a.name)!.set(b.name, (out.get(a.name)!.get(b.name) ?? 0) + sameFileWeight);
    }
  }
  return out;
}

/**
 * Merges groups, starting from one per interface, by average linkage: at each
 * step the related pair with the highest mean weight whose merged group fits
 * on one page. Groups keep the order of their first interfaces.
 */
function cluster(all: readonly Interface[], w: Map<string, Map<string, number>>, fits: (members: Interface[]) => boolean): Interface[][] {
  const gs = all.map((i) => [i]);
  const link = (a: Interface[], b: Interface[]) =>
    a.reduce((t, x) => t + b.reduce((s, y) => s + (w.get(x.name)!.get(y.name) ?? 0), 0), 0) / (a.length * b.length);
  for (;;) {
    const pairs: { a: number; b: number; l: number }[] = [];
    for (let a = 0; a < gs.length; a++) {
      for (let b = a + 1; b < gs.length; b++) {
        const l = link(gs[a], gs[b]);
        if (l > 0) pairs.push({ a, b, l });
      }
    }
    // Stable, so equal links keep the earlier pair first.
    const best = pairs.sort((x, y) => y.l - x.l).find(({ a, b }) => fits([...gs[a], ...gs[b]]));
    if (!best) return gs;
    gs[best.a] = [...gs[best.a], ...gs[best.b]];
    gs.splice(best.b, 1);
  }
}

/**
 * Orders items so each comes after those it depends on: repeatedly takes the
 * item with the fewest dependencies still to place, the earliest on a tie.
 * Cycles are broken that way too.
 */
function dependenciesFirst<T>(items: readonly T[], dependsOn: (a: T, b: T) => boolean): T[] {
  const left = [...items];
  const out: T[] = [];
  while (left.length > 0) {
    const waiting = left.map((a) => left.filter((b) => b !== a && dependsOn(a, b)).length);
    out.push(...left.splice(waiting.indexOf(Math.min(...waiting)), 1));
  }
  return out;
}

/** The interface most related to the rest of its group, which names the group. */
function central(members: readonly Interface[], w: Map<string, Map<string, number>>): string {
  const score = (i: Interface) => members.reduce((t, j) => t + (w.get(i.name)!.get(j.name) ?? 0), 0);
  return members.reduce((best, i) => (score(i) > score(best) ? i : best)).name;
}

/** A type alias: its definition, a one-line description, and what uses it. */
function aliasUnit(a: TypeAlias, refs: Refs): Unit {
  const lines = flow([{ font: "C", size, color: ink, text: a.text }], colWidth, size * 0.6, size * 2.4);
  if (a.doc) lines.push(...flow([{ font: "H", size, color: muted, text: firstSentence(a.doc) }], colWidth, size * 1.8));
  const usedBy = refs.usedBy.get(a.name) ?? [];
  if (usedBy.length > 0) {
    lines.push(...flow([
      { font: "HB", size, color: accent, text: "Used by " },
      { font: "H", size, color: ink, text: `${onPages(usedBy, refs, refs.pageOf(a.name))}.` },
    ], colWidth, size * 1.8, size * 3));
  }
  return { lines, keep: false, startsInterface: false, owner: "Types" };
}

/**
 * A group's heading, with the interfaces and types outside it that it refers
 * to, then its interfaces, then its types.
 */
function groupUnits(g: Group, refs: Refs): Unit[] {
  const inside = new Set([...g.members.map((i) => i.name), ...g.types.map((a) => a.name)]);
  const outside = [...new Set(g.members.flatMap((i) => [...i.extends, ...i.uses, ...refs.typesOf(i)]))].filter((n) => !inside.has(n));
  const lines = flow([{ font: "HB", size: nameSize, color: accent, text: `${g.name} group` }], colWidth);
  if (outside.length > 0) {
    lines.push(...flow([{ font: "H", size, color: muted, text: `Refers to ${onPages(outside, refs)}.` }], colWidth));
  }
  lines.push({ height: size * 0.6, segs: [] });
  const out: Unit[] = [{ lines, keep: true, startsInterface: true, owner: "" }, ...g.members.flatMap((i) => interfaceUnits(i, refs))];
  if (g.types.length > 0) {
    out.push({ lines: flow([{ font: "HB", size: nameSize, color: ink, text: "Types" }], colWidth), keep: true, startsInterface: true, owner: "Types" });
    out.push(...g.types.map((a) => aliasUnit(a, refs)));
  }
  return out;
}

// ---- Page ------------------------------------------------------------------

const pageW = 792;
const pageH = 612;
const margin = 36;
const columns = 2;
const gutter = 24;
const colWidth = (pageW - 2 * margin - (columns - 1) * gutter) / columns;

/** Page headings, the same height on every page. */
function heading(page: string, pages: string, summary: string): Line[] {
  return [
    ...flow([
      { font: "HB", size: 14, color: ink, text: "Interface summary" },
      { font: "H", size, color: muted, text: `   Page ${page} of ${pages}` },
    ], pageW - 2 * margin),
    ...flow([{ font: "H", size, color: muted, text: summary }], pageW - 2 * margin),
  ];
}

interface PlacedLine { col: number; y: number; line: Line }
interface Layout { lines: PlacedLine[]; rules: { col: number; y: number }[]; pages: number }

/**
 * Lays the units out in columns of the given height, page after page, or
 * returns null if they need more than maxPages. Column col is on page
 * floor(col / columns).
 */
function layout(us: readonly Unit[], height: number, maxPages: number): Layout | null {
  const placed: PlacedLine[] = [];
  const rules: { col: number; y: number }[] = [];
  let col = 0;
  let y = 0;
  for (let k = 0; k < us.length; k++) {
    const u = us[k];
    const gap = u.startsInterface && y > 0 && us[k - 1]?.owner !== "" ? size * (u.owner === "" ? 1.6 : 0.8) : 0;
    let need = gap + unitHeight(u);
    for (let j = k; us[j]?.keep && j + 1 < us.length; j++) need += unitHeight(us[j + 1]);
    let continued = false;
    if (y + need > height && y > 0) {
      col++;
      y = 0;
      continued = !u.startsInterface;
      if (col >= columns * maxPages) return null;
    } else {
      y += gap;
      if (gap > 0) rules.push({ col, y: y - gap / 2 });
    }
    if (continued) {
      const line = flow([{ font: "HB", size, color: muted, text: `${u.owner}, continued` }], colWidth)[0];
      placed.push({ col, y, line });
      y += line.height;
    }
    for (const line of u.lines) {
      placed.push({ col, y, line });
      y += line.height;
    }
  }
  return { lines: placed, rules, pages: Math.floor(col / columns) + 1 };
}

/** The content stream for each page. */
function render(all: readonly Interface[], date: string): string[] {
  const typeCount = typeAliases().length;
  const files = new Set(all.map((i) => i.file)).size;
  const summaryOf = (groups: number) =>
    `${all.length} interfaces and ${typeCount} type aliases from ${files} files, in ${groups} groups of related interfaces. ` +
    `Inherited members are listed under the interface that declares them. Generated ${date} by npm run summary.`;
  const top = margin + heading("00", "00", summaryOf(all.length)).reduce((t, l) => t + l.height, 0) + 16;
  const height = pageH - margin - top;

  const aliases = typeAliases();
  const mentioned = (text: string) => aliases.filter((a) => new RegExp(`\\b${a.name}\\b`).test(text)).map((a) => a.name);
  const typesOf = (i: Interface) => mentioned([i.typeParams, i.extendsClause, ...i.members.map((m) => m.signature)].join(" "));
  const usedBy = new Map<string, string[]>();
  const used = (n: string, by: string) => usedBy.set(n, [...(usedBy.get(n) ?? []), by]);
  for (const i of all) for (const n of new Set([...i.extends, ...i.uses, ...typesOf(i)])) used(n, i.name);
  for (const a of aliases) for (const n of mentioned(a.text.replace(/^type \w+/, ""))) used(n, a.name);
  // Each alias is listed with the first interface that mentions it, from its
  // own file if one does, else with its file's first interface.
  const home = (a: TypeAlias): string => {
    const users = all.filter((i) => typesOf(i).includes(a.name));
    const viaAlias = aliases.find((b) => b !== a && (usedBy.get(a.name) ?? []).includes(b.name));
    return (users.find((i) => i.file === a.file) ?? users[0])?.name
      ?? (viaAlias && home(viaAlias))
      ?? (all.find((i) => i.file === a.file) ?? all[0]).name;
  };
  const homes = new Map(aliases.map((a) => [a, home(a)]));
  const typesHomedIn = (members: readonly Interface[]) => aliases.filter((a) => members.some((i) => i.name === homes.get(a)));
  // Until pages are assigned, each interface and type is on a page of its
  // own, which makes every list of references at least as long as it will be.
  const names = [...all.map((i) => i.name), ...aliases.map((a) => a.name)];
  const placeholder: Refs = { pageOf: (name) => String(10 + names.indexOf(name)), usedBy, typesOf };
  const w = weights(all);
  const group = (members: Interface[]): Group => ({
    name: central(members, w),
    members: dependenciesFirst(members, refersTo),
    types: typesHomedIn(members),
  });
  const fits = (members: Interface[]) => layout(groupUnits(group(members), placeholder), height, 1) !== null;
  const groups = cluster(all, w, fits).map(group);
  const ordered = dependenciesFirst(groups, (a, b) => a.members.some((x) => b.members.some((y) => refersTo(x, y))));

  const units = (page: readonly Group[], refs: Refs) => page.flatMap((g) => groupUnits(g, refs));
  const pages: Group[][] = [];
  for (const g of ordered) {
    const last = pages[pages.length - 1];
    if (last && layout(units([...last, g], placeholder), height, 1) !== null) last.push(g);
    else pages.push([g]);
  }
  // A group too big for one page has a page to itself and runs onto the next.
  const start = new Map<string, number>();
  let next = 1;
  for (const p of pages) {
    for (const n of p.flatMap((g) => [...g.members.map((i) => i.name), ...g.types.map((a) => a.name)])) start.set(n, next);
    next += layout(units(p, placeholder), height, Infinity)!.pages;
  }
  const total = String(next - 1);

  const out: string[] = [];
  for (const p of pages) {
    const result = layout(units(p, { pageOf: (name) => String(start.get(name)), usedBy, typesOf }), height, Infinity)!;
    for (let k = 0; k < result.pages; k++) {
      const ops: string[] = [];
      const text = (seg: Seg, x: number, baseline: number) =>
        ops.push(`BT /${seg.font} ${seg.size.toFixed(2)} Tf ${seg.color.join(" ")} rg 1 0 0 1 ${x.toFixed(2)} ${baseline.toFixed(2)} Tm ${pdfString(seg.text)} Tj ET`);
      const rule = (x1: number, x2: number, y: number) =>
        ops.push(`${hairline.join(" ")} RG 0.5 w ${x1.toFixed(2)} ${y.toFixed(2)} m ${x2.toFixed(2)} ${y.toFixed(2)} l S`);
      let y = margin;
      for (const line of heading(String(out.length + 1), total, summaryOf(groups.length))) {
        for (const s of line.segs) text(s, margin + s.x, pageH - y - line.height * 0.8);
        y += line.height;
      }
      rule(margin, pageW - margin, pageH - y - 6);
      const onPage = (col: number) => Math.floor(col / columns) === k;
      const x0 = (col: number) => margin + (col % columns) * (colWidth + gutter);
      for (const { col, y: ly, line } of result.lines.filter((l) => onPage(l.col))) {
        for (const s of line.segs) text(s, x0(col) + s.x, pageH - top - ly - line.height * 0.8);
      }
      for (const r of result.rules.filter((r) => onPage(r.col))) rule(x0(r.col), x0(r.col) + colWidth, pageH - top - r.y);
      out.push(ops.join("\n"));
    }
  }
  console.log(`summary.pdf: ${all.length} interfaces in ${groups.length} groups on ${out.length} pages, smallest type ${size} pt`);
  for (const g of ordered) console.log(`  page ${start.get(g.name)}: ${g.name} group: ${g.members.map((i) => i.name).join(", ")}`);
  return out;
}

/** A PDF with one page per content stream, using the four standard fonts. */
function pdf(contents: readonly string[]): Buffer {
  const fonts = Object.entries(fontNames);
  const fontRefs = fonts.map(([key], n) => `/${key} ${3 + n} 0 R`).join(" ");
  const first = 3 + fonts.length;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${contents.map((_, p) => `${first + 2 * p} 0 R`).join(" ")}] /Count ${contents.length} >>`,
    ...fonts.map(([, name]) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`),
    ...contents.flatMap((content, p) => [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${first + 2 * p + 1} 0 R /Resources << /Font << ${fontRefs} >> >> >>`,
      `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    ]),
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
