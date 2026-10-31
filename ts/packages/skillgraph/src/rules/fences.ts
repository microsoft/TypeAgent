// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { kqlErrors } from "../kusto.js";
import type { MdCode } from "../markdown.js";
import type { Loc } from "../types.js";
import { defineRule } from "./sdk.js";

// Fenced code parses in its declared language; unlabeled fences are flagged.
//
//   ```json  {"a": 1,}          → json-invalid  (line 1 column 9)
//   ```kql   T | where | take 1 → kql-invalid   Missing expression
//   ```      gh pr view 1       → fence-lang-missing

const JSON_LANGS = new Set(["json"]);
const KQL_LANGS = new Set(["kql", "kusto"]);
/** JSON examples with comments, elisions, or placeholders are illustrative. */
const NOT_STRICT_JSON = /\/\/|\/\*|\.\.\.|…|<[\w .|-]+>|\{\{|^\s*#/m;
/** V8 JSON.parse position, e.g. "... (line 3 column 1)". */
const JSON_POS = /\(line (\d+) column (\d+)\)/;

function isJson(text: string): boolean {
    try {
        JSON.parse(text);
        return true;
    } catch {
        return false;
    }
}

/** Fence-relative 0-based offset → file location. */
function locAt(file: string, code: MdCode, offset: number): Loc {
    const before = code.value.slice(0, offset).split("\n");
    const line = code.line + before.length - 1;
    const col =
        before.length === 1
            ? code.col + before[0].length
            : before[before.length - 1].length + 1;
    return { file, line, col, endCol: col + 1 };
}

export const fencesRule = defineRule({
    meta: {
        name: "fences",
        description:
            "Fenced code parses in its language (JSON, KQL); fences declare a language.",
        diagnostics: {
            "json-invalid": "error",
            "kql-invalid": "error",
            "fence-lang-missing": "info",
        },
    },
    create: (ctx) => ({
        doc: ({ file, md }) => {
            for (const code of md.code) {
                if (code.lang === "inline") continue;
                const fence: Loc = {
                    file,
                    line: code.line - 1,
                    col: code.col,
                    endCol: code.col + 3,
                };
                if (code.lang === "") {
                    if (code.value.trim())
                        ctx.report({
                            rule: "fence-lang-missing",
                            at: fence,
                            message: "code fence has no language",
                        });
                } else if (JSON_LANGS.has(code.lang)) {
                    if (NOT_STRICT_JSON.test(code.value)) continue;
                    // Payload lists are JSON Lines: one document per line.
                    const lines = code.value
                        .split("\n")
                        .filter((l) => l.trim());
                    if (lines.length > 1 && lines.every(isJson)) continue;
                    try {
                        JSON.parse(code.value);
                    } catch (e) {
                        const msg = (e as Error).message;
                        const pos = JSON_POS.exec(msg);
                        ctx.report({
                            rule: "json-invalid",
                            at: pos
                                ? {
                                      file,
                                      line: code.line + Number(pos[1]) - 1,
                                      col: Number(pos[2]),
                                      endCol: Number(pos[2]) + 1,
                                  }
                                : fence,
                            message: msg.replace(JSON_POS, "").trim(),
                        });
                    }
                } else if (KQL_LANGS.has(code.lang)) {
                    for (const err of kqlErrors(code.value)) {
                        ctx.report({
                            rule: "kql-invalid",
                            at: locAt(file, code, err.offset),
                            message: err.message,
                        });
                    }
                }
            }
        },
    }),
});
