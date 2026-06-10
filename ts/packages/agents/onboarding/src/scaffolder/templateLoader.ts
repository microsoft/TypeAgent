// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared loader for the scaffolder's emitted-code templates.
//
// Templates live in `src/scaffolder/templates/*.ts` so a reviewer can
// read them as plain TypeScript (with syntax highlighting and
// `tsc`-level verification — see `__agentName__Schema.ts` for the
// type-check stub) instead of wading through 200-line template
// literals inside scaffolderHandler.ts.
//
// Placeholders use the `__TOKEN__` convention — chosen so the templates
// remain valid TypeScript identifiers (`class __AgentName__Bridge {}`,
// `process.env["__PORT_ENV__"]`, etc.). The substitution regex only
// matches identifiers wrapped in *paired* double-underscores, so
// Node's `__filename` / `__dirname` (single trailing underscore is
// absent) are left untouched.
//
// Templates are loaded at scaffold time (once per generated file) so the
// sync I/O cost is negligible and lets build* helpers stay synchronous —
// keeping their call sites unchanged.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// At runtime __dirname is `dist/scaffolder/`. Templates ship only in
// `src/` (this package isn't published to npm and the postbuild copies
// schema artifacts, not these). Resolve back to `src/scaffolder/templates`.
function templatePath(filename: string): string {
    return path.resolve(__dirname, "../../src/scaffolder/templates", filename);
}

// Files in the templates directory that are type-check scaffolding only
// (stubs for placeholder identifiers) and must never be loaded as a
// template at scaffold time.
const RESERVED_TEMPLATE_NAMES = new Set<string>(["__agentName__Schema.ts"]);

/**
 * Load `filename` from `src/scaffolder/templates/` and substitute every
 * `__TOKEN__` with `vars[TOKEN]`. Throws if any `__TOKEN__` placeholder
 * remains after substitution — that catches typos in either the
 * template or the caller's `vars` map at scaffold time rather than
 * emitting broken code.
 *
 * For TypeScript templates the recommended `vars` keys are:
 *   - `agentName`   (camelCase agent name)
 *   - `AgentName`   (PascalCase agent name)
 *   - `PORT_ENV`    (uppercase env-var name)
 *   - `BRIDGE_PORT` (numeric default port literal)
 *
 * Non-TS templates (`.template` extension) use the same `__TOKEN__`
 * convention as well.
 */
export function loadTemplate(
    filename: string,
    vars: Record<string, string>,
): string {
    if (RESERVED_TEMPLATE_NAMES.has(filename)) {
        throw new Error(
            `Template ${filename} is a type-check stub and cannot be loaded.`,
        );
    }
    const tpl = fs.readFileSync(templatePath(filename), "utf-8");
    // Single-pass regex replacement so a substituted value that happens
    // to contain a `__KEY__` token is NOT re-processed by a later
    // iteration -- important if a future caller ever passes a var
    // derived from user input. Unknown placeholders are left in place
    // and surfaced by the leftover check below.
    //
    // Requires *paired* leading and trailing double-underscores: matches
    // `__agentName__` but leaves Node's `__filename` (no trailing `__`)
    // and `____` (empty body) alone.
    const out = tpl.replace(/__([A-Za-z_][A-Za-z0-9_]*)__/g, (match, key) =>
        key in vars ? vars[key] : match,
    );
    const leftover = out.match(/__[A-Za-z_][A-Za-z0-9_]*__/g);
    if (leftover && leftover.length > 0) {
        const unique = Array.from(new Set(leftover)).join(", ");
        throw new Error(
            `Template ${filename} has unsubstituted placeholders: ${unique}`,
        );
    }
    return out;
}
