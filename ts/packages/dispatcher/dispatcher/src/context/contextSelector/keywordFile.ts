// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// The committed per-schema keyword file (design §5, "Source 1"): the baseline
// keyword vector for each of a schema's actions, produced once by standard
// extraction (§6 — LLM distillation preferred, lexical floor fallback). The
// contextSelector read path (KeywordIndex) prefers this file; the live lexical
// extractor is the guaranteed floor when it is absent. This is distinct from the
// profile-scoped `collision-keywords.json` sidecar (§5 "Source 2"), which stores
// user override *deltas* layered on top.
//
// Storage is per-agent, matching how the schema (`.pas.json`) and grammar
// (`.ag.json`) artifacts live in each agent's package: the keyword file is a
// SIBLING of the schema source (`<agent>/src/<schema>.keywords.json`), located
// via the already-absolute `ActionConfig` schema paths — the same
// "sibling of the schema file" convention `readSchemaConfig` uses for the
// `<schema>.json` config. Committed (not a build artifact) because the preferred
// producer is a one-off LLM pass, not a deterministic compiler step.

import path from "node:path";
import registerDebug from "debug";
import { readJsonFileSafe, writeJsonFileSafe } from "../../utils/fsUtils.js";
import { tokenize } from "./tokenize.js";

const debugKeywordFile = registerDebug(
    "typeagent:dispatcher:collision:contextSelector:keywordFile",
);

export const KEYWORD_FILE_SUFFIX = ".keywords.json";
export const KEYWORD_FILE_SCHEMA_VERSION = 1;

// How a keyword vector was produced — provenance for refresh pipelines and
// telemetry. `lexical` is the deterministic floor; `llm` is the distilled pass.
export type KeywordFileProducer = "llm" | "lexical";

export type KeywordFile = {
    schemaVersion: number;
    schema: string;
    generatedBy: KeywordFileProducer;
    generatedAt: string;
    // Source hash of the schema the vectors were produced from (from
    // ActionSchemaFile.sourceHash). Lets a future refresh pipeline detect drift
    // — a committed file whose hash no longer matches the live schema is stale.
    sourceHash?: string;
    // action name -> keyword vector (canonical tokens; order ignored).
    actions: Record<string, string[]>;
};

// The `<schema>.keywords.json` sibling of a schema SOURCE file.
function siblingKeywordPath(schemaPath: string): string {
    const parsed = path.parse(schemaPath);
    return path.join(parsed.dir, `${parsed.name}${KEYWORD_FILE_SUFFIX}`);
}

// A committed keyword file only ever sits beside an agent's schema SOURCE — an
// absolute `<name>.ts` — so both the read path and the backfill agree on exactly
// one committable location (§5). Returns undefined (→ lexical floor) for schemas
// we must NOT place a file beside:
//   - no path at all (dynamic/inline agents),
//   - a relative path: inline/system agents carry package-relative schema paths
//     (they bypass patchPaths); resolving those against cwd would scatter files
//     into a bogus tree, so treat them as "no committed file",
//   - a compiled `.pas.json` with no `.ts` source: `dist` is a transient build
//     artifact, not a place to commit an authored keyword file.
// Prefers the original `.ts` source, falling back to the schema file when that
// is itself the `.ts` source. Both `ActionConfig` paths are absolute for NPM
// agents (patched at load).
export function keywordFilePathFor(
    originalSchemaFilePath: string | undefined,
    schemaFilePath: string | undefined,
): string | undefined {
    const base = originalSchemaFilePath ?? schemaFilePath;
    if (base === undefined || !path.isAbsolute(base) || !/\.ts$/i.test(base)) {
        return undefined;
    }
    return siblingKeywordPath(base);
}

// Canonicalize every token through the SAME tokenizer the scorer / context
// vector use (§12), so a committed file — even one hand-edited or produced
// outside `keywordProducer` — always stores tokens that can actually match at
// scoring time ("Cells" -> "cell", "spreadsheets" -> "spreadsheet"; stopwords /
// generic verbs dropped). Idempotent for already-canonical producer output.
function sanitizeActions(
    actions: Record<string, unknown>,
): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [name, vec] of Object.entries(actions)) {
        if (!Array.isArray(vec)) {
            continue;
        }
        const seen = new Set<string>();
        const canonical: string[] = [];
        for (const raw of vec) {
            if (typeof raw !== "string") {
                continue;
            }
            for (const token of tokenize(raw)) {
                if (!seen.has(token)) {
                    seen.add(token);
                    canonical.push(token);
                }
            }
        }
        out[name] = canonical;
    }
    return out;
}

// Validate + normalize a parsed keyword-file object (pure — no I/O), degrading
// to undefined when the shape is wrong so callers fall back to the lexical
// floor. Exposed for unit testing.
export function parseKeywordFileContent(
    parsed: unknown,
    schemaName: string,
): KeywordFile | undefined {
    const obj = parsed as Partial<KeywordFile> | undefined;
    if (
        obj === undefined ||
        typeof obj !== "object" ||
        typeof obj.actions !== "object" ||
        obj.actions === null
    ) {
        return undefined;
    }
    return {
        schemaVersion:
            typeof obj.schemaVersion === "number"
                ? obj.schemaVersion
                : KEYWORD_FILE_SCHEMA_VERSION,
        schema: typeof obj.schema === "string" ? obj.schema : schemaName,
        generatedBy: obj.generatedBy === "llm" ? "llm" : "lexical",
        generatedAt: typeof obj.generatedAt === "string" ? obj.generatedAt : "",
        ...(typeof obj.sourceHash === "string"
            ? { sourceHash: obj.sourceHash }
            : {}),
        actions: sanitizeActions(obj.actions as Record<string, unknown>),
    };
}

// Load and validate a keyword file at the given path, degrading to undefined
// (never throwing) when the path is unset, missing, or malformed so the caller
// falls back to the lexical floor. `schemaName` is only the default for a file
// missing its own `schema` field.
export function loadKeywordFile(
    filePath: string | undefined,
    schemaName: string,
): KeywordFile | undefined {
    if (filePath === undefined) {
        return undefined;
    }
    const parsed = readJsonFileSafe(filePath, (e) =>
        debugKeywordFile(`Failed to load keyword file ${filePath}: ${e}`),
    );
    return parseKeywordFileContent(parsed, schemaName);
}

// Persist a keyword file to the given path. Returns the path on success,
// undefined on failure (routed to `onError` for the backfill to report).
export function writeKeywordFile(
    filePath: string,
    file: KeywordFile,
    onError?: (error: unknown) => void,
): string | undefined {
    let failed = false;
    writeJsonFileSafe(filePath, file, (e) => {
        failed = true;
        debugKeywordFile(`Failed to write keyword file ${filePath}: ${e}`);
        onError?.(e);
    });
    return failed ? undefined : filePath;
}
