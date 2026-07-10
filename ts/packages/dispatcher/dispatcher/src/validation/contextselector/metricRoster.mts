// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Roster loader for the contextSelector metric benchmark. Loads EVERY committed
// per-agent keyword file (`<schema>.keywords.json`, §5 Source 1) across the real
// agent roster and exposes them through the REAL production read path — a
// `KeywordIndex` over an `ActionSchemaSource` whose `getKeywordFile` returns the
// loaded files, with an empty sidecar. So the benchmark scores candidates using
// the exact `effective()` vectors the dispatcher would, generalized beyond the
// single list+vampire pair the earlier proof harness used. Deterministic,
// network-free, no LLM.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    KeywordFile,
    loadKeywordFile,
    KEYWORD_FILE_SUFFIX,
} from "../../context/contextSelector/keywordFile.js";
import {
    ActionSchemaSource,
    KeywordIndex,
} from "../../context/contextSelector/keywordIndex.js";
import { KeywordSidecar } from "../../context/contextSelector/keywordSidecar.js";
import { KeywordVector } from "../../context/contextSelector/keywordVector.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// contextSelector -> benchmark -> dispatcher -> dispatcher -> packages -> ts
const TS_ROOT = path.resolve(HERE, "..", "..", "..", "..", "..", "..");
const AGENTS_DIR = path.join(TS_ROOT, "packages", "agents");

// One committed action vector, resolved through the real index.
export type TopicalAction = {
    schemaName: string;
    actionName: string;
    // The effective (committed) keyword vector — canonical tokens.
    keywords: KeywordVector;
};

export type Roster = {
    // The real production read path, over the committed files + empty sidecar.
    index: KeywordIndex;
    // Every committed keyword file, keyed by its own `schema` field.
    files: Map<string, KeywordFile>;
    // Keyword-rich actions only (vector size >= minVectorSize) — the ones with
    // enough discriminating signal to manufacture an honest collision from.
    actions: TopicalAction[];
    // Real committed keyword files discovered on disk.
    fileCount: number;
};

// Recursively collect every `*.keywords.json` under a directory, sorted for a
// stable, reproducible roster order (Gate B determinism).
function findKeywordFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "dist") {
                    continue;
                }
                walk(full);
            } else if (entry.name.endsWith(KEYWORD_FILE_SUFFIX)) {
                out.push(full);
            }
        }
    };
    walk(dir);
    return out.sort();
}

export type LoadRosterOptions = {
    // Minimum committed-vector size for an action to count as "topical" — below
    // this there is too little discriminating signal for an honest collision.
    minVectorSize?: number;
};

export function loadRoster(opts: LoadRosterOptions = {}): Roster {
    const minVectorSize = opts.minVectorSize ?? 8;
    const paths = findKeywordFiles(AGENTS_DIR);
    if (paths.length === 0) {
        throw new Error(
            `no committed ${KEYWORD_FILE_SUFFIX} files under ${AGENTS_DIR}`,
        );
    }

    const files = new Map<string, KeywordFile>();
    for (const filePath of paths) {
        // Default schema name from the file stem (dropping the suffix), but the
        // file's own `schema` field is authoritative — that is the key the
        // dispatcher looks a candidate up by.
        const stem = path.basename(filePath, KEYWORD_FILE_SUFFIX);
        const file = loadKeywordFile(filePath, stem);
        if (file === undefined) {
            continue;
        }
        // Keep the first file for a schema name (stable given sorted paths).
        if (!files.has(file.schema)) {
            files.set(file.schema, file);
        }
    }

    return buildRoster(files, minVectorSize);
}

// Build a Roster over an in-memory keyword-file map, using the SAME production
// read path (KeywordIndex.effective over an ActionSchemaSource + empty sidecar)
// as the real roster. Shared by loadRoster (committed files) and the adversarial
// synthetic-agent family so both exercise identical scoring machinery.
export function buildRoster(
    files: Map<string, KeywordFile>,
    minVectorSize = 8,
): Roster {
    const source: ActionSchemaSource = {
        getKeywordFile: (schemaName) => files.get(schemaName),
        getSchemaDescription: () => undefined,
        getActionDefinition: () => undefined,
    };
    const index = new KeywordIndex(source, () => KeywordSidecar.empty());

    const actions: TopicalAction[] = [];
    for (const [schemaName, file] of files) {
        for (const actionName of Object.keys(file.actions).sort()) {
            const keywords = index.effective(schemaName, actionName);
            if (keywords.size >= minVectorSize) {
                actions.push({ schemaName, actionName, keywords });
            }
        }
    }
    actions.sort((a, b) =>
        `${a.schemaName}.${a.actionName}` < `${b.schemaName}.${b.actionName}`
            ? -1
            : 1,
    );

    return { index, files, actions, fileCount: files.size };
}

// The discriminating tokens of A against B: tokens in A's vector that B does not
// share. These are the ONLY tokens that can move the scorer (shared tokens
// cancel via candidate-local IDF, §9), so honest resolve/tie fixtures must be
// authored from them.
export function discriminating(a: KeywordVector, b: KeywordVector): string[] {
    const out: string[] = [];
    for (const t of a) {
        if (!b.has(t)) {
            out.push(t);
        }
    }
    return out.sort();
}
