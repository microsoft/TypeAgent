// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { defineRule } from "./sdk.js";

// Skill files read by bundled scripts:
//   scripts/run.py: open("references/schema.json")
//     ──skill root or script dir──▶ exists? referenced : script-path-missing
// Only literals whose first folder exists in the skill count, so
// "output/report.md" (written at runtime) and URLs are ignored.

const SCRIPT_FILE = /\.(py|js|mjs|cjs|ts|mts|sh|bash|ps1)$/;
/** Quoted relative path with a folder and an extension: "references/x.json". */
const PATH_LITERAL =
    /(["'])((?:\.\/)?[\w.-]+(?:[/\\][\w.-]+)+\.[A-Za-z]\w*)\1/g;

export const scriptFilesRule = defineRule({
    meta: {
        name: "script-files",
        description: "Skill files named in bundled scripts exist.",
        diagnostics: { "script-path-missing": "error" },
    },
    // Runs before orphans so found files count as referenced.
    create: (ctx) => ({
        skillEnd: () => {
            const { skill } = ctx;
            for (const file of ctx.files) {
                if (!SCRIPT_FILE.test(file)) continue;
                const lines = (ctx.read(file) ?? "").split("\n");
                lines.forEach((line, i) => {
                    for (const m of line.matchAll(PATH_LITERAL)) {
                        const p = m[2].replace(/\\/g, "/").replace(/^\.\//, "");
                        const first = p.split("/")[0];
                        if (!isDir(path.join(skill.dir, first))) continue;
                        const hits = [
                            path.join(skill.dir, p),
                            path.resolve(path.dirname(file), p),
                        ].filter((t) => fs.existsSync(t));
                        if (hits.length) {
                            hits.forEach((t) => ctx.referenced.add(t));
                            continue;
                        }
                        const col = m.index! + 2;
                        ctx.report({
                            rule: "script-path-missing",
                            at: {
                                file,
                                line: i + 1,
                                col,
                                endCol: col + m[2].length,
                            },
                            message: `${p} does not exist in skill ${skill.name}`,
                        });
                    }
                });
            }
        },
    }),
});

function isDir(p: string): boolean {
    try {
        return fs.statSync(p).isDirectory();
    } catch {
        return false;
    }
}
