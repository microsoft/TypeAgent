// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Temporary: re-canonicalize every committed keyword file through the (now
// idempotent) tokenizer, rewriting in place. Deterministic — only files whose
// stored tokens weren't already fixed points change on disk (e.g. the "licens"
// -> "licen" fix). Preserves schema/provenance; no LLM.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    parseKeywordFileContent,
    writeKeywordFile,
} from "agent-dispatcher/contextSelector";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
// contextSelectorBench -> src -> defaultAgentProvider -> packages -> ts
const TS_ROOT = path.resolve(MODULE_DIR, "..", "..", "..", "..");
const AGENTS_DIR = path.join(TS_ROOT, "packages", "agents");

function findKeywordFiles(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...findKeywordFiles(full));
        else if (e.name.endsWith(".keywords.json")) out.push(full);
    }
    return out;
}

const files = findKeywordFiles(AGENTS_DIR);
let changed = 0;
for (const file of files) {
    const before = fs.readFileSync(file, "utf8");
    const parsed = parseKeywordFileContent(
        JSON.parse(before),
        path.basename(file).replace(/\.keywords\.json$/i, ""),
    );
    if (parsed === undefined) {
        process.stderr.write(`SKIP (unparseable): ${file}\n`);
        continue;
    }
    writeKeywordFile(file, parsed);
    const after = fs.readFileSync(file, "utf8");
    if (after !== before) {
        changed++;
        process.stdout.write(
            `recanonicalized: ${path.relative(TS_ROOT, file)}\n`,
        );
    }
}
process.stdout.write(`\n${files.length} files scanned, ${changed} changed.\n`);
