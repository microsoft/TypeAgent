// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs/promises";
import type { SourceFile } from "./packageInputs.js";

/**
 * Common system / debug / Node.js / OS environment variables we don't
 * want to surface as "package-required setup". These show up in many
 * packages (e.g. `process.env.NODE_ENV`, `process.env.DEBUG`) but
 * don't represent setup the contributor needs to perform — they're
 * either set by the runtime, the OS, or the dev tooling.
 *
 * The whitelist of *what we DO show* is everything else: typically
 * project-specific keys like `DISCORD_BOT_TOKEN`, `OPENAI_API_KEY`,
 * `AZURE_OPENAI_ENDPOINT`, etc.
 */
const COMMON_ENV_DENYLIST = new Set<string>([
    // Node.js runtime
    "NODE_ENV",
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_DEBUG",
    "NODE_NO_WARNINGS",
    // debug package
    "DEBUG",
    "DEBUG_COLORS",
    "DEBUG_DEPTH",
    "DEBUG_FD",
    "DEBUG_HIDE_DATE",
    "DEBUG_SHOW_HIDDEN",
    // OS / shell
    "PATH",
    "HOME",
    "USER",
    "USERNAME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "PROGRAMFILES",
    "PROGRAMDATA",
    "SYSTEMROOT",
    "WINDIR",
    "TMPDIR",
    "TEMP",
    "TMP",
    "LANG",
    "LC_ALL",
    "PWD",
    "SHELL",
    "TERM",
    "COMSPEC",
    "OS",
    // CI / common build tooling noise
    "CI",
    "GITHUB_ACTIONS",
    "GITHUB_WORKSPACE",
    "RUNNER_OS",
    "FORCE_COLOR",
    "NO_COLOR",
    "COLORTERM",
]);

/**
 * Tests / specs / fixtures often set or read env vars to drive
 * mocking; those don't represent real setup requirements so we skip
 * them.
 */
const TEST_PATH_PATTERNS = [
    /\/test\//,
    /\/tests\//,
    /\/__tests__\//,
    /\/fixtures?\//,
    /\.spec\.[cm]?[tj]sx?$/,
    /\.test\.[cm]?[tj]sx?$/,
    /\/mock[s]?\//,
];

/**
 * Match `process.env.NAME` and `process.env["NAME"]` /
 * `process.env['NAME']` references. Captures the variable name (must
 * be SCREAMING_SNAKE-case-ish: at least 2 chars, uppercase letters,
 * digits, underscore — leading char must be a letter or underscore).
 *
 * The pattern is intentionally narrow: lowercase identifiers are
 * almost always not env vars (they tend to be local property reads
 * on something else named `process.env`). The 2-char minimum filters
 * out single-letter noise like `process.env.E`.
 */
const PROCESS_ENV_REGEX =
    /process\.env(?:\.([A-Z_][A-Z0-9_]+)|\[\s*['"`]([A-Z_][A-Z0-9_]+)['"`]\s*\])/g;

/**
 * Scan the package's source files for `process.env.<NAME>` references
 * and return the sorted set of project-specific env vars. System /
 * debug / runtime env vars are filtered out (see denylist) so callers
 * only see the keys a contributor would actually need to configure.
 *
 * Returns an empty array on any I/O error (the env-vars subsection is
 * optional — best-effort).
 */
export async function detectEnvVars(
    sourceFiles: readonly SourceFile[],
): Promise<string[]> {
    const seen = new Set<string>();
    for (const file of sourceFiles) {
        if (TEST_PATH_PATTERNS.some((re) => re.test(file.relPath))) continue;
        // Only scan textual source (we already filter by extension upstream
        // because walkSrc only yields source files, but be defensive).
        if (!isTextSource(file.relPath)) continue;
        let content: string;
        try {
            content = await fs.readFile(file.absPath, "utf8");
        } catch {
            continue;
        }
        collectEnvVarsFromText(content, seen);
    }
    return [...seen].sort();
}

/**
 * Pure-string variant of `detectEnvVars`, exported for tests and for
 * callers that already hold the source text in memory.
 */
export function collectEnvVarsFromText(
    text: string,
    out: Set<string> = new Set<string>(),
): Set<string> {
    PROCESS_ENV_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PROCESS_ENV_REGEX.exec(text)) !== null) {
        const name = m[1] ?? m[2];
        if (!name) continue;
        if (COMMON_ENV_DENYLIST.has(name)) continue;
        out.add(name);
    }
    return out;
}

function isTextSource(relPath: string): boolean {
    return /\.[cm]?[tj]sx?$/.test(relPath);
}
