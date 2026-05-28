// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared loader for the scaffolder's emitted-code templates.
//
// Templates live in `src/scaffolder/templates/*.template` so a reviewer
// can read them as plain code (with syntax highlighting) instead of
// wading through 200-line template literals inside scaffolderHandler.ts.
//
// Placeholders use `{{TOKEN}}` syntax — chosen because the emitted code
// is itself TypeScript that contains `${...}` template literals, so
// reusing `${...}` for our own substitutions would collide. The same
// `{{...}}` convention is used by cliHandler.template.
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

/**
 * Load `filename` from `src/scaffolder/templates/` and substitute every
 * `{{KEY}}` with `vars[KEY]`. Throws if any `{{...}}` placeholder remains
 * after substitution — that catches typos in either the template or the
 * caller's `vars` map at scaffold time rather than emitting broken code.
 */
export function loadTemplate(
    filename: string,
    vars: Record<string, string>,
): string {
    let tpl = fs.readFileSync(templatePath(filename), "utf-8");
    for (const [key, value] of Object.entries(vars)) {
        tpl = tpl.split(`{{${key}}}`).join(value);
    }
    const leftover = tpl.match(/\{\{[A-Z0-9_]+\}\}/g);
    if (leftover && leftover.length > 0) {
        const unique = Array.from(new Set(leftover)).join(", ");
        throw new Error(
            `Template ${filename} has unsubstituted placeholders: ${unique}`,
        );
    }
    return tpl;
}
