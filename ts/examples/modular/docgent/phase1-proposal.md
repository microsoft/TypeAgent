# Docgent: phase 1 proposal (for agreement)

Status: draft, 2026-11-13. Nothing here is in a design file yet. Each
interface, member and rule below needs the human's agreement before it
is written into one (method.md, principle 4).

The docgent's tools are a script, `node docgent.ts <command>`, over a
corpus: a directory of files copied from one commit. The design below is
what the script's parts must do. The docgent itself (the model following
`CLAUDE.md`) is outside phase 1; its scenarios are the gold Q&A.

## The platform subset: `fileSystem.ts`

A slice of Node's `node:fs`, with Node's names and signatures, so that
Node's own module fits it with no adapter. It is all an implementation
may use to reach files. Its double holds a corpus in memory, so a damaged
corpus (a section removed, a claim planted, a term swapped) is a double
with one file changed.

```ts
export interface FileSystem {
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string): string[];
  existsSync(path: string): boolean;
}
```

## The interfaces

```ts
/** A file in the corpus, by its path relative to the corpus root, such as "method.md". */
export type DocId = string & { readonly __doc: unique symbol };

/** A section: "<doc>#<slug>", the slug made from its heading as GitHub makes anchors. */
export type SectionId = string & { readonly __section: unique symbol };

/** A markdown section: its heading and everything up to the next heading at its level or above. */
export interface Section {
  readonly id: SectionId;
  readonly doc: DocId;
  readonly title: string;
  /** 1 for "#", 2 for "##", and so on. */
  readonly level: number;
  /** The section's text, its heading line included, exactly as in the file. */
  readonly text: string;
}

/** What the docgent sees first: every section, with a one-line gloss. */
export interface MapEntry {
  readonly id: SectionId;
  readonly title: string;
  readonly level: number;
  /** A gloss on the section: adds nothing to it. Written once per build, reviewed. */
  readonly summary: string;
}

/** A rule as the design states it. */
export interface RuleEntry {
  readonly id: string;
  readonly tag: string;
  readonly headline: string;
  readonly expression: string | null;
  readonly doc: DocId;
}

/** The corpus, read through a FileSystem. */
export interface Corpus {
  /** Every markdown section, in document order, documents in path order. */
  sections(): readonly Section[];
  section(id: SectionId): Section | undefined;
  /** The rules in the corpus's interface files, in file order. */
  rules(): readonly RuleEntry[];
  rule(id: string): RuleEntry | undefined;
}

/** What the script's commands return, and the log of their calls (observability). */
export interface Tools {
  map(): readonly MapEntry[];
  section(id: SectionId): Section | undefined;
  rule(id: string): RuleEntry | undefined;
  term(name: string): TermEntry | undefined;
  tour(name: string): Tour | undefined;
  /** Reports each command as it is answered: name, arguments, and the IDs returned. */
  readonly logCalls: EventEmitter<{ called: [call: ToolCall] }>;
}
```

`TermEntry` (a term's declaring file and declaration text), `Tour` (named
steps, each with a caption and the section or rule it shows) and
`ToolCall` follow the same pattern; I'll draft them once the shape above
is agreed.

## The rules (headlines; expressions to be written with them)

Corpus:
- **sections.partition**: For each document, its top-level sections'
  texts, in order, join to the whole file after any text before the
  first heading. Nothing is lost or repeated.
- **sections.nested**: A section's text contains the texts of the sections
  under it, in order.
- **sections.unique-ids**: No two sections share an ID. (Repeated headings
  in one document get "-1", "-2", as GitHub does.)
- **section.agrees**: `section(id)` returns exactly the entry of
  `sections()` with that ID, or undefined.
- **rules.as-catalog**: `rules()` gives the same IDs, tags, headlines and
  expressions as the method's own rule parser on the same files.
- **reads-only**: Nothing calls the FileSystem except to read.

Tools:
- **map.covers**: Every section has exactly one map entry, with its ID,
  title and level, and every map entry's ID resolves.
- **map.glosses**: Every summary is non-empty and one line. Whether it
  adds nothing is for review, as for any gloss.
- **logs-each**: Each command call is reported once, after it is answered,
  with the IDs it returned.
- **deterministic**: The same corpus gives the same answers.

Scenarios (the gold Q&A, judged rather than computed): each names a
question, an audience, key points, claims it must not make, and sources.
What a judged test is, and how far the method covers it, is the open
question this docgent is meant to answer.

## Questions

1. The section IDs: GitHub-style anchors, so they match links readers
   already know? Or numbered paths such as `method.md#2.3`?
2. `rules.as-catalog` ties the docgent to the method's parser. Agreed, or
   should the docgent define rules on its own?
3. Is `term` (a term's declaration) in for the first version, or does
   `rule` plus `section` cover managers' questions well enough?
