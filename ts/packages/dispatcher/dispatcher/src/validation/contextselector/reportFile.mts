// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Single consolidated output target for the contextSelector benchmark. Both the
// deterministic arm (measureMetrics) and the LLM arm (compareLlm) write into ONE
// markdown report, defaulting to a fixed local path next to the scripts
// (overridable with `--out <dir>`). measureMetrics writes the base report,
// truncating any prior content (including a stale LLM section); compareLlm
// upserts its own marked section. Any run order or repetition is therefore
// idempotent — the file always ends up as the metrics report followed by exactly
// one LLM-comparison section.

import fs from "node:fs";
import path from "node:path";

export const REPORT_FILENAME = "contextSelector-report.md";

// Resolve the report path: `--out <dir>` if provided, else `defaultDir` (each
// caller passes its own module directory so the report lands next to the
// scripts). Creates the directory if needed.
export function resolveReportPath(defaultDir: string): string {
    const idx = process.argv.indexOf("--out");
    const dir =
        idx !== -1 && process.argv[idx + 1]
            ? process.argv[idx + 1]
            : defaultDir;
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, REPORT_FILENAME);
}

// measureMetrics owns the base of the file: truncate + write. This clears any
// stale LLM section from a prior run, so a fresh `reproduce` always yields a
// clean metrics-then-LLM document.
export function writeBaseReport(reportPath: string, markdown: string): void {
    fs.writeFileSync(reportPath, ensureTrailingNewline(markdown), "utf8");
}

const LLM_BEGIN = "<!-- BEGIN contextSelector-vs-llm -->";
const LLM_END = "<!-- END contextSelector-vs-llm -->";

// compareLlm upserts its section into the shared file: drop any existing block
// between the markers, then append a fresh one. Idempotent across repeated runs,
// and correct whether or not the base report already exists.
export function upsertLlmSection(reportPath: string, markdown: string): void {
    let existing = "";
    try {
        existing = fs.readFileSync(reportPath, "utf8");
    } catch {
        existing = "";
    }
    const base = stripSection(existing, LLM_BEGIN, LLM_END);
    const prefix = base.trim().length > 0 ? ensureTrailingNewline(base) : "";
    const block = `${LLM_BEGIN}\n${markdown.trim()}\n${LLM_END}\n`;
    fs.writeFileSync(reportPath, prefix + block, "utf8");
}

// Remove a `begin..end` marked block (inclusive of both markers) from `text`,
// if present, and trim trailing whitespace.
function stripSection(text: string, begin: string, end: string): string {
    const b = text.indexOf(begin);
    if (b === -1) {
        return text.trimEnd();
    }
    const e = text.indexOf(end, b);
    const rest = e === -1 ? "" : text.slice(e + end.length);
    return (text.slice(0, b) + rest).trimEnd();
}

function ensureTrailingNewline(s: string): string {
    return s.endsWith("\n") ? s : s + "\n";
}
