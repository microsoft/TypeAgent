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

// The `<schema>.keywords.json` sibling of a schema file. Strips a trailing
// `.pas` (from `<name>.pas.json`) so both the `.ts` source and the compiled
// `.pas.json` resolve to the same `<name>.keywords.json`.
function siblingKeywordPath(schemaPath: string): string {
    const parsed = path.parse(schemaPath);
    const name = parsed.name.replace(/\.pas$/i, "");
    return path.join(parsed.dir, `${name}${KEYWORD_FILE_SUFFIX}`);
}

// Absolute path to a schema's keyword file — a sibling of the schema SOURCE. The
// single point that decides where keyword files live (§5). Prefers the original
// schema source (`src/<name>.ts`, where a committed file belongs) and falls back
// to the compiled schema file (`dist/<name>.pas.json`). Both `ActionConfig`
// paths are already absolute (patched at agent load). Returns undefined when a
// schema has no file path (dynamic/inline agents) — those use the lexical floor.
export function keywordFilePathFor(
    originalSchemaFilePath: string | undefined,
    schemaFilePath: string | undefined,
): string | undefined {
    const base = originalSchemaFilePath ?? schemaFilePath;
    return base !== undefined ? siblingKeywordPath(base) : undefined;
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
