// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Sandbox edit primitives used by the source-editing levers. Phase 2 ships
// `replaceJSDoc` and `replacePasActionDescription` — needed by the `jsdoc`
// lever. The remaining primitives (`replaceManifestDescription`,
// `appendExampleTag`, `markDeprecated`, `writeActionConfigOverride`) land
// in Phase 4 alongside the rest of the levers.
//
// Every primitive enforces an `originalChecksum` guard: SHA-1 of the
// **entire** target file at run-start. Mismatch → throw. The optimize loop
// captures the checksum into `CaseDescription.originalChecksum` once per
// case; drift between run-start and apply (e.g., the operator edited the
// source while a run was in flight) is caught here rather than producing
// surprise mutations.

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";

const AGENTS_SUBDIR = "agents";

// =============================================================================
// Public types
// =============================================================================

export interface ApplyTsJSDocOpts {
    /** Root of the sandbox tree. Files are read/written under
     *  `<sandboxDir>/agents/<schemaName>/`. */
    sandboxDir: string;
    schemaName: string;
    /** Interface name without the "Action" suffix recognition is loose —
     *  matches the literal `${actionTypeName} {` block, where
     *  `actionTypeName` may be `${actionName}Action` or whatever the
     *  caller passes. */
    actionTypeName: string;
    /** The new comment block to place above the interface declaration.
     *  Each line should already be comment-formatted (line `//` or block
     *  JSDoc). The function does not transform the text. Trailing newline
     *  required. */
    newCommentBlock: string;
    /** SHA-1 of the full target file at run-start. Mismatch throws. */
    originalChecksum: string;
    /** Schema file basename inside the sandbox agent dir. Defaults to
     *  `schema.ts`. */
    schemaFileName?: string;
}

export interface ApplyPasDescriptionOpts {
    sandboxDir: string;
    schemaName: string;
    /** Action name to target. Matches the PAS schema entry by `name`. */
    actionName: string;
    newDescription: string;
    /** SHA-1 of the full target file at run-start. Mismatch → throw. */
    originalChecksum: string;
    /** Schema file basename inside the sandbox agent dir. Defaults to
     *  `schema.pas.json`. */
    schemaFileName?: string;
}

export interface ApplyResult {
    filesWritten: string[];
}

// =============================================================================
// Checksum helpers
// =============================================================================

/** SHA-1 of the file's full content. Use this to populate
 *  `CaseDescription.originalChecksum`. */
export function checksumFile(filePath: string): string {
    const content = fs.readFileSync(filePath);
    return crypto.createHash("sha1").update(content).digest("hex");
}

/** SHA-1 of an in-memory string. Used by tests. */
export function checksumString(s: string): string {
    return crypto.createHash("sha1").update(s).digest("hex");
}

function verifyChecksum(filePath: string, expected: string): void {
    const actual = checksumFile(filePath);
    if (actual !== expected) {
        throw new Error(
            `Drift detected in ${filePath}: expected SHA-1 ${expected}, got ${actual}. ` +
                `Source moved between run-start and apply. Re-run @collision optimize explore.`,
        );
    }
}

// =============================================================================
// replaceJSDoc — .ts schema source
// =============================================================================

/**
 * Replace the comment block immediately above `export interface
 * <ActionTypeName> {` (or `interface <ActionTypeName> {`) with
 * `newCommentBlock`. Idempotent on the new text — a re-run with the same
 * inputs produces byte-identical output.
 *
 * Comment-block matching: walks backward from the interface line through
 * contiguous lines whose first non-whitespace token is `//` or whose
 * trimmed text is part of a `/* ... * /` block.
 */
export function replaceJSDoc(opts: ApplyTsJSDocOpts): ApplyResult {
    const fileName = opts.schemaFileName ?? "schema.ts";
    const filePath = path.join(
        opts.sandboxDir,
        AGENTS_SUBDIR,
        opts.schemaName,
        fileName,
    );
    if (!fs.existsSync(filePath)) {
        throw new Error(`replaceJSDoc: target file not found: ${filePath}`);
    }
    verifyChecksum(filePath, opts.originalChecksum);

    const original = fs.readFileSync(filePath, "utf-8");
    const lines = original.split(/\r?\n/);

    // Locate the interface declaration line. Accept "export interface", "interface".
    const re = new RegExp(
        `^\\s*(?:export\\s+)?interface\\s+${escapeRegex(opts.actionTypeName)}\\b`,
    );
    let interfaceIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
            interfaceIdx = i;
            break;
        }
    }
    if (interfaceIdx < 0) {
        throw new Error(
            `replaceJSDoc: interface '${opts.actionTypeName}' not found in ${filePath}`,
        );
    }

    // Walk backward over a contiguous comment block. Permissive:
    //   //          (line comment)
    //   /** ... */  (single-line JSDoc)
    //   /**         (start of multi-line)
    //   * ...       (continuation)
    //   */          (end)
    //   blank line  (treated as part of the block IF the surrounding lines
    //                are comments — but we stop at non-comment non-blank)
    let blockStart = interfaceIdx;
    for (let i = interfaceIdx - 1; i >= 0; i--) {
        const t = lines[i]!.trim();
        if (t === "") {
            // Stop at blank line — comment blocks above an interface are
            // typically contiguous; whitespace separation indicates the
            // operator intended the block to be distinct.
            break;
        }
        if (
            t.startsWith("//") ||
            t.startsWith("/**") ||
            t.startsWith("/*") ||
            t.startsWith("*") ||
            t === "*/"
        ) {
            blockStart = i;
            continue;
        }
        break;
    }

    // newCommentBlock should end with a newline so the join below produces
    // exactly one separator between the new block and the interface line.
    let normalizedBlock = opts.newCommentBlock;
    if (!normalizedBlock.endsWith("\n")) normalizedBlock += "\n";
    // Strip trailing newline so the array join doesn't insert an extra
    // blank line.
    const blockLines = normalizedBlock.replace(/\n$/, "").split(/\r?\n/);

    const before = lines.slice(0, blockStart);
    const after = lines.slice(interfaceIdx);
    const newLines = [...before, ...blockLines, ...after];

    // Preserve original line ending convention.
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const newContent = newLines.join(eol);
    fs.writeFileSync(filePath, newContent);

    return { filesWritten: [filePath] };
}

// =============================================================================
// replacePasActionDescription — .pas.json schema
// =============================================================================

/**
 * Replace the `description` field of the action named `actionName` in the
 * PAS schema. The PAS format is a structured JSON; this primitive parses,
 * mutates, and serializes with stable indentation.
 *
 * The PAS schema's `types` object contains entries keyed by type name; an
 * action's type has a `comments` field (an array of strings) that serves
 * as the description in PAS. v1 replaces that array with a single-line
 * description string. Multi-line descriptions are supported via `\n`
 * embedded in `newDescription`.
 */
export function replacePasActionDescription(
    opts: ApplyPasDescriptionOpts,
): ApplyResult {
    const fileName = opts.schemaFileName ?? "schema.pas.json";
    const filePath = path.join(
        opts.sandboxDir,
        AGENTS_SUBDIR,
        opts.schemaName,
        fileName,
    );
    if (!fs.existsSync(filePath)) {
        throw new Error(
            `replacePasActionDescription: target file not found: ${filePath}`,
        );
    }
    verifyChecksum(filePath, opts.originalChecksum);

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);

    const target = findActionInPas(parsed, opts.actionName);
    if (!target) {
        throw new Error(
            `replacePasActionDescription: action '${opts.actionName}' not found in ${filePath}`,
        );
    }

    // Description in PAS is carried as a `comments` array of strings (one
    // line per entry). Replace with the new content split by newline.
    target.comments = opts.newDescription.split(/\r?\n/);

    // Preserve 2-space JSON indentation — matches the schema-asc output.
    const newContent = JSON.stringify(parsed, undefined, 2);
    // Preserve trailing newline if present in the original.
    const final = content.endsWith("\n") ? newContent + "\n" : newContent;
    fs.writeFileSync(filePath, final);

    return { filesWritten: [filePath] };
}

/**
 * Find the action's type object in a parsed PAS schema. PAS is structured
 * as `{ version, entry, types: { TypeName: { name, comments?, ... }, ... } }`.
 * The entry is typically a union; each member type has `actionName` as a
 * string-literal field. We walk `types` looking for an action whose
 * `actionName` string-literal matches `actionName`.
 *
 * Defensive: PAS schemas in this repo may vary in shape. The lookup tries
 * (1) types entries whose `comments` already document an action with
 * matching `actionName`, then (2) types entries whose own name is
 * `${actionName}Action` (PascalCase + "Action" suffix convention).
 */
function findActionInPas(
    parsed: unknown,
    actionName: string,
): { comments?: string[] } | null {
    if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("types" in parsed) ||
        typeof (parsed as any).types !== "object"
    ) {
        return null;
    }
    const types = (parsed as any).types as Record<string, any>;

    // Strategy 1: scan for a type whose actionName literal matches.
    for (const def of Object.values(types)) {
        const actionNameLiteral = extractActionNameLiteral(def);
        if (actionNameLiteral === actionName) {
            return def as { comments?: string[] };
        }
    }
    // Strategy 2: name convention <ActionPascal>Action.
    const pascal = actionName.charAt(0).toUpperCase() + actionName.slice(1);
    const guess = types[`${pascal}Action`];
    if (guess && typeof guess === "object") {
        return guess as { comments?: string[] };
    }
    // Strategy 3: the caller (typically an LLM-generated payload) may
    // have prefixed actionName with the schema name (e.g.
    // "visualStudio.removeBreakpoint" instead of "removeBreakpoint").
    // Retry with the bit after the last dot.
    const lastDot = actionName.lastIndexOf(".");
    if (lastDot > 0 && lastDot < actionName.length - 1) {
        return findActionInPas(parsed, actionName.slice(lastDot + 1));
    }
    return null;
}

/**
 * Pull the `actionName` string-literal value out of a PAS type definition.
 * The PAS shape varies; try the obvious fields. Returns undefined when no
 * literal is present (e.g., the type is not an action).
 */
function extractActionNameLiteral(def: unknown): string | undefined {
    if (typeof def !== "object" || def === null) return undefined;
    const d = def as Record<string, any>;
    // Common shape: { type: "object", fields: { actionName: { type: "string-union", typeEnum: ["..."] } } }
    const actionName = d.fields?.actionName ?? d.actionName;
    if (!actionName || typeof actionName !== "object") return undefined;
    if (
        Array.isArray(actionName.typeEnum) &&
        actionName.typeEnum.length === 1
    ) {
        return String(actionName.typeEnum[0]);
    }
    if (typeof actionName.value === "string") {
        return actionName.value;
    }
    return undefined;
}

function escapeRegex(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// =============================================================================
// replaceManifestDescription — sandbox manifest.json schema.description
// =============================================================================

export interface ApplyManifestDescriptionOpts {
    sandboxDir: string;
    schemaName: string;
    /** New text for `schema.description`. The translator includes this in
     *  its prompt as the schema's identity line. */
    newDescription: string;
    /** SHA-1 of the full manifest.json at run-start. */
    originalChecksum: string;
    /** Manifest file basename inside the sandbox agent dir. Defaults to
     *  `manifest.json`. */
    manifestFileName?: string;
}

/**
 * Replace the `schema.description` field in the sandbox manifest.
 * Preserves all other fields and 2-space JSON indentation. The manifest
 * lever uses this to widen the schema-level identity that the translator
 * sees in its system prompt.
 */
export function replaceManifestDescription(
    opts: ApplyManifestDescriptionOpts,
): ApplyResult {
    const fileName = opts.manifestFileName ?? "manifest.json";
    const filePath = path.join(
        opts.sandboxDir,
        AGENTS_SUBDIR,
        opts.schemaName,
        fileName,
    );
    if (!fs.existsSync(filePath)) {
        throw new Error(
            `replaceManifestDescription: target file not found: ${filePath}`,
        );
    }
    verifyChecksum(filePath, opts.originalChecksum);

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);
    if (!parsed.schema || typeof parsed.schema !== "object") {
        throw new Error(
            `replaceManifestDescription: ${filePath} has no schema object to edit`,
        );
    }
    parsed.schema.description = opts.newDescription;

    const newContent = JSON.stringify(parsed, undefined, 2);
    const final = content.endsWith("\n") ? newContent + "\n" : newContent;
    fs.writeFileSync(filePath, final);

    return { filesWritten: [filePath] };
}

// =============================================================================
// appendExampleTag — JSDoc @example tags (.ts) OR example text (PAS)
// =============================================================================

export interface ApplyExampleTagOpts {
    sandboxDir: string;
    schemaName: string;
    /** For .ts: the action's TypeScript interface name (e.g.
     *  "PlayTrackAction"). For PAS: the action's name as it appears in
     *  the `actionName` literal (e.g. "playTrack"). */
    target: string;
    /** User/agent example pairs, one example per array entry. Each entry
     *  is a `{user, agent}` pair; the formatter writes them as
     *  `// User: ...` / `// Agent: ...` lines for .ts schemas or as
     *  appended description text for PAS schemas. */
    examples: { user: string; agent: string }[];
    /** SHA-1 of the full target file at run-start. */
    originalChecksum: string;
    /** "ts" → schema.ts; "pas" → schema.pas.json. */
    sourceKind: "ts" | "pas";
    /** Custom schema file basename inside the sandbox agent dir. Defaults
     *  to schema.ts / schema.pas.json based on `sourceKind`. */
    schemaFileName?: string;
    /** Only required when `sourceKind === "pas"`. The action name to
     *  target in the .pas.json types map. */
    pasActionName?: string;
}

/**
 * Append example tags to an action's documentation. For .ts schemas,
 * inserts `// User: …` / `// Agent: …` lines at the TOP of the existing
 * comment block (above any IMPORTANT lines and the identity line) so the
 * LLM reads examples before constraints — matching the SCHEMA_GUIDELINES
 * convention "broader context furthest away, specific rules closer."
 *
 * For PAS schemas, appends the same example lines to the action's
 * `comments` array.
 */
export function appendExampleTag(opts: ApplyExampleTagOpts): ApplyResult {
    if (opts.sourceKind === "ts") {
        return appendExampleTsImpl(opts);
    }
    return appendExamplePasImpl(opts);
}

function appendExampleTsImpl(opts: ApplyExampleTagOpts): ApplyResult {
    const fileName = opts.schemaFileName ?? "schema.ts";
    const filePath = path.join(
        opts.sandboxDir,
        AGENTS_SUBDIR,
        opts.schemaName,
        fileName,
    );
    if (!fs.existsSync(filePath)) {
        throw new Error(`appendExampleTag: target file not found: ${filePath}`);
    }
    verifyChecksum(filePath, opts.originalChecksum);

    const original = fs.readFileSync(filePath, "utf-8");
    const lines = original.split(/\r?\n/);

    const re = new RegExp(
        `^\\s*(?:export\\s+)?interface\\s+${escapeRegex(opts.target)}\\b`,
    );
    let interfaceIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
            interfaceIdx = i;
            break;
        }
    }
    if (interfaceIdx < 0) {
        throw new Error(
            `appendExampleTag: interface '${opts.target}' not found in ${filePath}`,
        );
    }

    // Walk back to the start of the contiguous comment block above the
    // interface. Same logic as replaceJSDoc — stops at blank line or
    // non-comment text.
    let blockStart = interfaceIdx;
    for (let i = interfaceIdx - 1; i >= 0; i--) {
        const t = lines[i]!.trim();
        if (t === "") break;
        if (
            t.startsWith("//") ||
            t.startsWith("/**") ||
            t.startsWith("/*") ||
            t.startsWith("*") ||
            t === "*/"
        ) {
            blockStart = i;
            continue;
        }
        break;
    }

    // Indentation: match whatever the existing block uses; default to the
    // interface line's leading whitespace.
    const referenceLine =
        blockStart < interfaceIdx ? lines[blockStart]! : lines[interfaceIdx]!;
    const indent = referenceLine.match(/^\s*/)?.[0] ?? "";

    const exampleLines: string[] = [];
    for (const ex of opts.examples) {
        exampleLines.push(`${indent}// User: ${ex.user}`);
        exampleLines.push(`${indent}// Agent: ${ex.agent}`);
    }

    const before = lines.slice(0, blockStart);
    const block = lines.slice(blockStart, interfaceIdx);
    const after = lines.slice(interfaceIdx);
    // Insert examples at the TOP of the existing block — broader context
    // furthest from the identity line per SCHEMA_GUIDELINES ordering.
    const newLines = [...before, ...exampleLines, ...block, ...after];

    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    fs.writeFileSync(filePath, newLines.join(eol));

    return { filesWritten: [filePath] };
}

function appendExamplePasImpl(opts: ApplyExampleTagOpts): ApplyResult {
    if (!opts.pasActionName) {
        throw new Error(
            "appendExampleTag: pasActionName is required when sourceKind is 'pas'",
        );
    }
    const fileName = opts.schemaFileName ?? "schema.pas.json";
    const filePath = path.join(
        opts.sandboxDir,
        AGENTS_SUBDIR,
        opts.schemaName,
        fileName,
    );
    if (!fs.existsSync(filePath)) {
        throw new Error(`appendExampleTag: target file not found: ${filePath}`);
    }
    verifyChecksum(filePath, opts.originalChecksum);

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);

    const target = findActionInPas(parsed, opts.pasActionName);
    if (!target) {
        throw new Error(
            `appendExampleTag: action '${opts.pasActionName}' not found in ${filePath}`,
        );
    }
    target.comments = target.comments ?? [];
    for (const ex of opts.examples) {
        target.comments.push(`User: ${ex.user}`);
        target.comments.push(`Agent: ${ex.agent}`);
    }

    const newContent = JSON.stringify(parsed, undefined, 2);
    const final = content.endsWith("\n") ? newContent + "\n" : newContent;
    fs.writeFileSync(filePath, final);

    return { filesWritten: [filePath] };
}

// =============================================================================
// markDeprecated — @deprecated tag (.ts) OR [DEPRECATED] prefix (PAS)
// =============================================================================

export interface ApplyMarkDeprecatedOpts {
    sandboxDir: string;
    schemaName: string;
    /** "ts" → schema.ts; "pas" → schema.pas.json. */
    sourceKind: "ts" | "pas";
    /** For .ts: the action's TypeScript interface name. For PAS: ignored
     *  (use pasActionName). */
    target: string;
    /** Required when sourceKind === "pas". */
    pasActionName?: string;
    /** Reason text appended after the @deprecated marker (or after
     *  "[DEPRECATED]" for PAS). The translator can read this so the LLM
     *  knows WHY the action is gone — useful when the deprecated action
     *  is being absorbed by a sibling. */
    reason: string;
    /** SHA-1 of the full target file at run-start. */
    originalChecksum: string;
    /** Custom schema file basename. */
    schemaFileName?: string;
}

const DEPRECATED_PREFIX = "[DEPRECATED] ";

/**
 * Mark an action deprecated. For .ts schemas, inserts a `@deprecated`
 * line at the top of the comment block. For PAS schemas, prepends
 * "[DEPRECATED] " to the description's first comment line (idempotent —
 * re-applying doesn't double the prefix).
 */
export function markDeprecated(opts: ApplyMarkDeprecatedOpts): ApplyResult {
    if (opts.sourceKind === "ts") {
        return markDeprecatedTsImpl(opts);
    }
    return markDeprecatedPasImpl(opts);
}

function markDeprecatedTsImpl(opts: ApplyMarkDeprecatedOpts): ApplyResult {
    const fileName = opts.schemaFileName ?? "schema.ts";
    const filePath = path.join(
        opts.sandboxDir,
        AGENTS_SUBDIR,
        opts.schemaName,
        fileName,
    );
    if (!fs.existsSync(filePath)) {
        throw new Error(`markDeprecated: target file not found: ${filePath}`);
    }
    verifyChecksum(filePath, opts.originalChecksum);

    const original = fs.readFileSync(filePath, "utf-8");
    const lines = original.split(/\r?\n/);

    const re = new RegExp(
        `^\\s*(?:export\\s+)?interface\\s+${escapeRegex(opts.target)}\\b`,
    );
    let interfaceIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i]!)) {
            interfaceIdx = i;
            break;
        }
    }
    if (interfaceIdx < 0) {
        throw new Error(
            `markDeprecated: interface '${opts.target}' not found in ${filePath}`,
        );
    }

    let blockStart = interfaceIdx;
    for (let i = interfaceIdx - 1; i >= 0; i--) {
        const t = lines[i]!.trim();
        if (t === "") break;
        if (
            t.startsWith("//") ||
            t.startsWith("/**") ||
            t.startsWith("/*") ||
            t.startsWith("*") ||
            t === "*/"
        ) {
            blockStart = i;
            continue;
        }
        break;
    }

    const referenceLine =
        blockStart < interfaceIdx ? lines[blockStart]! : lines[interfaceIdx]!;
    const indent = referenceLine.match(/^\s*/)?.[0] ?? "";

    // Idempotent: skip if a @deprecated line is already present in the block.
    const existingBlock = lines
        .slice(blockStart, interfaceIdx)
        .map((l) => l.trim())
        .join("\n");
    if (/@deprecated\b/.test(existingBlock)) {
        return { filesWritten: [] };
    }

    const newLines = [
        ...lines.slice(0, blockStart),
        `${indent}// @deprecated ${opts.reason}`,
        ...lines.slice(blockStart),
    ];

    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    fs.writeFileSync(filePath, newLines.join(eol));

    return { filesWritten: [filePath] };
}

function markDeprecatedPasImpl(opts: ApplyMarkDeprecatedOpts): ApplyResult {
    if (!opts.pasActionName) {
        throw new Error(
            "markDeprecated: pasActionName is required when sourceKind is 'pas'",
        );
    }
    const fileName = opts.schemaFileName ?? "schema.pas.json";
    const filePath = path.join(
        opts.sandboxDir,
        AGENTS_SUBDIR,
        opts.schemaName,
        fileName,
    );
    if (!fs.existsSync(filePath)) {
        throw new Error(`markDeprecated: target file not found: ${filePath}`);
    }
    verifyChecksum(filePath, opts.originalChecksum);

    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content);

    const target = findActionInPas(parsed, opts.pasActionName);
    if (!target) {
        throw new Error(
            `markDeprecated: action '${opts.pasActionName}' not found in ${filePath}`,
        );
    }
    target.comments = target.comments ?? [];
    const first = target.comments[0] ?? "";
    if (!first.startsWith(DEPRECATED_PREFIX)) {
        target.comments[0] = `${DEPRECATED_PREFIX}${opts.reason}. ${first}`.trimEnd();
        // If there was no first line at all, just stamp the deprecation marker.
        if (target.comments[0].trim() === DEPRECATED_PREFIX.trim()) {
            target.comments[0] = `${DEPRECATED_PREFIX}${opts.reason}`;
        }
    } else {
        // Already deprecated; idempotent no-op.
        return { filesWritten: [] };
    }

    const newContent = JSON.stringify(parsed, undefined, 2);
    const final = content.endsWith("\n") ? newContent + "\n" : newContent;
    fs.writeFileSync(filePath, final);

    return { filesWritten: [filePath] };
}

// =============================================================================
// writeActionConfigOverride — sandbox-side action filter sidecar
// =============================================================================

export interface ApplyActionConfigOverrideOpts {
    sandboxDir: string;
    schemaName: string;
    /** Actions to hide from getActionConfigs() / getActionSchemaFileForConfig().
     *  Schema-relative names. */
    droppedActions: string[];
}

/**
 * Write `sandbox/overrides/<schemaName>.actionConfig.json`. Read by the
 * `withActionConfigOverride` wrapper around the sandbox provider — drops
 * the listed actions from translator-visible schema files without
 * touching the underlying schema source. The durable artifact (operator-
 * applied) is the `@deprecated` JSDoc; the override is sandbox-only.
 */
export function writeActionConfigOverride(
    opts: ApplyActionConfigOverrideOpts,
): ApplyResult {
    const overridesDir = path.join(opts.sandboxDir, "overrides");
    fs.mkdirSync(overridesDir, { recursive: true });
    const filePath = path.join(
        overridesDir,
        `${opts.schemaName}.actionConfig.json`,
    );
    const payload = {
        schemaVersion: 1 as const,
        droppedActions: [...opts.droppedActions].sort(),
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, undefined, 2));
    return { filesWritten: [filePath] };
}
