// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { promises as fs } from "node:fs";

/**
 * One action declared by an agent's `*Schema.ts` file.
 *
 * Extracted purely from source text — no TypeScript compiler involved.
 * The shape mirrors the convention agents follow:
 *
 * ```ts
 * // <description line(s)>
 * // Sample phrases:
 * //   - "<phrase>"
 * //   - "<phrase>"
 * export type FooBarAction = {
 *     actionName: "fooBar";
 *     parameters: {
 *         // <field comment>
 *         <fieldName>: <type>;
 *     };
 * };
 * ```
 */
export interface AgentAction {
    /** TypeScript type name (e.g. `TakePhotoAction`). */
    readonly typeName: string;
    /** String literal value of `actionName` (e.g. `takePhoto`). */
    readonly actionName: string;
    /**
     * Joined description from the leading `//` comment lines that
     * precede the `export type` declaration. Stops at the
     * `// Sample phrases:` marker if present. Empty string when
     * no description was found.
     */
    readonly description: string;
    /**
     * Sample-phrase strings extracted from the
     * `// Sample phrases:` comment block. Empty when absent.
     */
    readonly samplePhrases: readonly string[];
    /**
     * Parameters declared inside the `parameters: { ... }` block.
     * Empty when the action has no parameters or the block is
     * `parameters?: { ... }` and was empty.
     */
    readonly parameters: readonly ActionParameter[];
    /**
     * True when the action's `actionName` literal appears in the
     * agent's handler source (as a string literal — typically a
     * `case "x":` arm or an `actionName === "x"` check). Defaults to
     * `true` so callers that don't run implementation detection
     * (e.g. tests or schema-only flows) treat every declared action
     * as implemented.
     *
     * Set by `markImplementedActions` after the schema parser runs.
     */
    readonly implemented: boolean;
}

export interface ActionParameter {
    /** Field name as written in the schema. */
    readonly name: string;
    /** True when declared with a trailing `?` (optional field). */
    readonly optional: boolean;
    /**
     * The TypeScript type as a single-line string. Multi-line union
     * types and nested object literals are flattened with spaces.
     */
    readonly type: string;
    /** Joined leading `//` comment lines. Empty when none. */
    readonly description: string;
}

/**
 * Read a `*Schema.ts` file and extract every `export type … = { actionName: …; … }`
 * action declaration it contains. Returns an empty array when the
 * file is missing or unreadable, or when no actions match.
 *
 * Conservative regex parsing — designed for the highly conventional
 * shape used in `ts/packages/agents/**`. Anything outside that shape
 * (e.g. union types of multiple actions in a single declaration) is
 * skipped silently.
 */
export async function extractActionsFromSchema(
    schemaAbsPath: string,
): Promise<AgentAction[]> {
    let source: string;
    try {
        source = await fs.readFile(schemaAbsPath, "utf8");
    } catch {
        return [];
    }
    return extractActionsFromSource(source);
}

/**
 * Pure parser variant — useful for tests that don't want to touch the
 * filesystem.
 */
export function extractActionsFromSource(source: string): AgentAction[] {
    const lines = source.split(/\r?\n/u);
    const actions: AgentAction[] = [];

    for (let i = 0; i < lines.length; i++) {
        // Match any `export type Foo = {` declaration; we only retain
        // the type if the body actually contains an `actionName: "..."`
        // literal (validated below). The legacy `\w+Action` suffix
        // requirement was too strict — it dropped agents that named a
        // type without the Action suffix (e.g. `StartEditList`).
        const declMatch = /^export\s+type\s+(\w+)\s*=\s*\{/u.exec(lines[i]!);
        if (!declMatch) continue;
        const typeName = declMatch[1]!;

        // Walk backward to gather contiguous leading // comment lines.
        const leadingComments: string[] = [];
        for (let j = i - 1; j >= 0; j--) {
            const trimmed = lines[j]!.trim();
            if (trimmed.startsWith("//")) {
                leadingComments.unshift(stripCommentMarker(trimmed));
            } else if (trimmed === "") {
                break;
            } else {
                break;
            }
        }

        const { description, samplePhrases } =
            splitDescriptionAndPhrases(leadingComments);

        // Walk forward from the opening `{` to find the matching `}`.
        // Track brace depth in a very lightweight way; this is enough
        // because action types are syntactically simple.
        const bodyEnd = findMatchingBrace(lines, i);
        const bodyLines = lines.slice(i + 1, bodyEnd);

        const actionName = findActionNameLiteral(bodyLines);
        if (actionName === null) continue;

        const parameters = extractParameters(bodyLines);

        actions.push({
            typeName,
            actionName,
            description,
            samplePhrases,
            parameters,
            implemented: true,
        });
    }

    return actions;
}

function stripCommentMarker(line: string): string {
    // "// foo" → " foo", "//foo" → "foo".
    let s = line.slice(2);
    if (s.startsWith(" ")) s = s.slice(1);
    return s;
}

function splitDescriptionAndPhrases(comments: readonly string[]): {
    description: string;
    samplePhrases: string[];
} {
    const descLines: string[] = [];
    const phraseLines: string[] = [];
    let mode: "desc" | "phrases" = "desc";
    for (const c of comments) {
        const trimmed = c.trim();
        if (/^sample\s+phrases?\s*:?\s*$/iu.test(trimmed)) {
            mode = "phrases";
            continue;
        }
        if (mode === "desc") {
            descLines.push(c);
        } else {
            phraseLines.push(c);
        }
    }
    const description = descLines.join(" ").replace(/\s+/gu, " ").trim();
    const samplePhrases: string[] = [];
    for (const raw of phraseLines) {
        const m = /^\s*-\s*"([^"]*)"\s*$/u.exec(raw);
        if (m) {
            samplePhrases.push(m[1]!);
            continue;
        }
        const m2 = /^\s*-\s*'([^']*)'\s*$/u.exec(raw);
        if (m2) samplePhrases.push(m2[1]!);
    }
    return { description, samplePhrases };
}

function findMatchingBrace(
    lines: readonly string[],
    startLine: number,
): number {
    let depth = 0;
    for (let i = startLine; i < lines.length; i++) {
        const line = lines[i]!;
        for (const ch of line) {
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) return i;
            }
        }
    }
    return lines.length;
}

function findActionNameLiteral(bodyLines: readonly string[]): string | null {
    for (const line of bodyLines) {
        const m = /^\s*actionName\s*:\s*"([^"]+)"\s*;?/u.exec(line);
        if (m) return m[1]!;
        const m2 = /^\s*actionName\s*:\s*'([^']+)'\s*;?/u.exec(line);
        if (m2) return m2[1]!;
    }
    return null;
}

function extractParameters(bodyLines: readonly string[]): ActionParameter[] {
    // Locate `parameters` (with optional `?`) followed by `: {`.
    let paramOpenLine = -1;
    for (let i = 0; i < bodyLines.length; i++) {
        if (/^\s*parameters\s*\??\s*:\s*\{/u.test(bodyLines[i]!)) {
            paramOpenLine = i;
            break;
        }
    }
    if (paramOpenLine === -1) return [];

    // Find the closing brace of the parameters object, balancing
    // braces inside (e.g. nested object types in a field).
    let depth = 0;
    let paramCloseLine = -1;
    for (let i = paramOpenLine; i < bodyLines.length; i++) {
        const line = bodyLines[i]!;
        for (const ch of line) {
            if (ch === "{") depth++;
            else if (ch === "}") {
                depth--;
                if (depth === 0) {
                    paramCloseLine = i;
                    break;
                }
            }
        }
        if (paramCloseLine !== -1) break;
    }
    if (paramCloseLine === -1) return [];

    const inner = bodyLines.slice(paramOpenLine + 1, paramCloseLine);
    const params: ActionParameter[] = [];
    let pendingComments: string[] = [];
    let nestedDepth = 0;
    let buf = "";

    const flushField = (raw: string): void => {
        const fieldMatch =
            /^\s*([A-Za-z_$][\w$]*)\s*(\??)\s*:\s*([\s\S]+?);?\s*$/u.exec(raw);
        if (!fieldMatch) {
            pendingComments = [];
            return;
        }
        const [, name, opt, type] = fieldMatch;
        params.push({
            name: name!,
            optional: opt === "?",
            type: type!.replace(/\s+/gu, " ").trim(),
            description: pendingComments.join(" ").replace(/\s+/gu, " ").trim(),
        });
        pendingComments = [];
    };

    for (const rawLine of inner) {
        const line = rawLine;
        const trimmed = line.trim();
        if (trimmed.startsWith("//")) {
            pendingComments.push(stripCommentMarker(trimmed));
            continue;
        }
        if (trimmed === "") continue;

        // Track depth within the parameters block so nested object
        // types can span multiple physical lines.
        for (const ch of trimmed) {
            if (ch === "{") nestedDepth++;
            else if (ch === "}") nestedDepth--;
        }

        buf = buf.length > 0 ? `${buf} ${trimmed}` : trimmed;

        if (nestedDepth === 0 && (buf.endsWith(";") || buf.endsWith(","))) {
            flushField(buf.replace(/[,;]\s*$/u, ""));
            buf = "";
        }
    }
    if (buf.trim().length > 0 && nestedDepth === 0) {
        flushField(buf);
    }

    return params;
}

/**
 * Scan the given handler source file and return the subset of
 * `actionNames` whose name appears in a *dispatch* context. The
 * detection is intentionally conservative — we only accept patterns
 * the agent handlers in this monorepo use to actually route an
 * action to its implementation:
 *
 *   - switch / case arm: `case "addItems":`
 *   - equality comparison: `action.actionName === "addItems"` or
 *     `"addItems" === action.actionName` (covers `==` too)
 *
 * Mentions in comments (line `//` or block `/* * /`), JSDoc, plain
 * log messages, import paths, or guard-list `Set`/array literals do
 * NOT count as implementation. The error mode is now skewed toward
 * false-negatives (an action implemented via a non-standard pattern
 * may be marked unimplemented), which is the safer direction: docs
 * understate implementation status rather than overstate it.
 *
 * Returns `null` when the handler file cannot be read. Callers should
 * treat a `null` result as "implementation status unknown" and leave
 * each action's existing `implemented` flag in place.
 */
export async function detectImplementedActionNames(
    handlerAbsPath: string,
    actionNames: readonly string[],
): Promise<Set<string> | null> {
    let source: string;
    try {
        source = await fs.readFile(handlerAbsPath, "utf8");
    } catch {
        return null;
    }
    // Strip comments once so every per-action regex sees the same
    // dispatch-only view of the source.
    const cleaned = stripCommentsForDispatchScan(source);
    const found = new Set<string>();
    for (const name of actionNames) {
        if (handlerMentionsAction(cleaned, name)) found.add(name);
    }
    return found;
}

/**
 * Remove single-line and block comments so dispatch-shaped strings
 * inside JSDoc / `// TODO: case "X":` etc. are not counted as
 * implementations. Not string-literal-aware (would over-engineer for
 * the rare case where a string literal contains `//`); the worst
 * effect is dropping a string mention that would have been counted
 * anyway, which is acceptable.
 */
function stripCommentsForDispatchScan(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//gu, " ")
        .replace(/\/\/[^\n]*/gu, " ");
}

function handlerMentionsAction(cleaned: string, actionName: string): boolean {
    if (actionName.length === 0) return false;
    const escaped = actionName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    // A quoted form of the action name in any of the three accepted
    // string-literal styles. Reused in every alternation branch below.
    const quoted = `(?:"${escaped}"|'${escaped}'|\`${escaped}\`)`;
    // Match exactly one of the dispatch shapes:
    //   1. `case "X":`  — switch dispatch
    //   2. `=== "X"` / `== "X"`  — equality on the right
    //   3. `"X" ===` / `"X" ==`  — equality on the left
    // The leading `\b` before `case` keeps us from matching
    // `xcase "X":` or similar identifier-tail false positives.
    const dispatchPattern = new RegExp(
        `(?:` +
            `\\bcase\\s+${quoted}\\s*:` +
            `|` +
            `===?\\s*${quoted}` +
            `|` +
            `${quoted}\\s*===?` +
            `)`,
        "u",
    );
    return dispatchPattern.test(cleaned);
}

/**
 * Return a copy of `actions` with `implemented` set according to the
 * supplied set of names. When `implementedNames` is `null` the input
 * array is returned unchanged so callers can avoid downgrading the
 * default `implemented: true` simply because the handler file was
 * missing.
 */
export function markImplementedActions(
    actions: readonly AgentAction[],
    implementedNames: Set<string> | null,
): AgentAction[] {
    if (implementedNames === null) return [...actions];
    return actions.map((a) => ({
        ...a,
        implemented: implementedNames.has(a.actionName),
    }));
}
