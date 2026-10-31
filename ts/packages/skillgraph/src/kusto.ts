// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as vm from "node:vm";

// KQL syntax check with Microsoft's Kusto parser (Kusto.Language, the engine
// behind the Kusto LSP/Monaco). Its Bridge.NET build is a plain script that
// defines `Kusto`; it is evaluated once in a VM context, lazily (~0.4s).
//
//   "T | where | take 1" ──KustoCode.Parse──▶ [{ offset: 9, message: "Missing expression" }]

const require = createRequire(import.meta.url);
const PACKAGE = "@kusto/language-service-next";
/** Bridge runtime, then the Kusto.Language assembly. */
export const KUSTO_FILES = ["bridge.min.js", "Kusto.Language.Bridge.min.js"];
/** Doc placeholders: `{device_id}`, `<n>`, `<ids from §1>`; masked to a same-length literal ("0   "). */
const PLACEHOLDER = /\{\{?[\w.-]+\}?\}|<[A-Za-z_][^<>\n=]*>/g;
/** Docs show fragments: "| top 10 by x", "extend a = 1", "Id = tolower(x)". */
const FRAGMENT_PREFIXES = ["", "T ", "T | ", "print "];
/** Docs list several queries per fence, separated by blank lines. */
const BLANK_LINE = /\n[ \t]*\n/g;
/** Elided query text ("| project a, b, ..."): not checkable. */
const ELISION = /\.\.\.|…/;

export interface KqlError {
    offset: number;
    message: string;
}

interface KustoDiagnostic {
    Start: number;
    Message: string;
    Severity: string;
}
interface KustoGlobal {
    Language: {
        KustoCode: {
            Parse(text: string): {
                GetSyntaxDiagnostics(): {
                    Count: number;
                    getItem(i: number): KustoDiagnostic;
                };
            };
        };
    };
}

let kusto: KustoGlobal | undefined;

/** Bundles (VS Code extension) ship the files beside the script. */
function locate(file: string): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bundled = path.join(here, file);
    return fs.existsSync(bundled)
        ? bundled
        : require.resolve(`${PACKAGE}/${file}`);
}

function load(): KustoGlobal {
    if (!kusto) {
        // Own context: no globals leak, and it works under test sandboxes.
        const sandbox = vm.createContext({ console });
        for (const f of KUSTO_FILES) {
            vm.runInContext(fs.readFileSync(locate(f), "utf8"), sandbox, {
                filename: f,
            });
        }
        kusto = (sandbox as { Kusto: KustoGlobal }).Kusto;
    }
    return kusto;
}

function parseErrors(text: string): KqlError[] {
    const ds = load().Language.KustoCode.Parse(text).GetSyntaxDiagnostics();
    const out: KqlError[] = [];
    for (let i = 0; i < ds.Count; i++) {
        const d = ds.getItem(i);
        if (d.Severity === "Error")
            out.push({ offset: d.Start, message: d.Message });
    }
    return out;
}

/** A fragment is valid if any doc-style prefix makes it a query. */
function fragmentErrors(text: string): KqlError[] {
    let first: KqlError[] | undefined;
    for (const prefix of FRAGMENT_PREFIXES) {
        const errs = parseErrors(prefix + text).map((e) => ({
            ...e,
            offset: Math.max(0, e.offset - prefix.length),
        }));
        if (!errs.length) return [];
        first ??= errs;
    }
    return first ?? [];
}

/** Syntax errors only: tables and columns are unknown without a schema. */
export function kqlErrors(text: string): KqlError[] {
    if (ELISION.test(text)) return [];
    const masked = text.replace(PLACEHOLDER, (m) => "0".padEnd(m.length));
    if (!fragmentErrors(masked).length) return [];
    // Retry per blank-line block; offsets stay fence-relative.
    const out: KqlError[] = [];
    let start = 0;
    for (const m of [...masked.matchAll(BLANK_LINE), undefined]) {
        const end = m ? m.index : masked.length;
        const block = masked.slice(start, end);
        if (block.trim())
            for (const e of fragmentErrors(block))
                out.push({ ...e, offset: e.offset + start });
        if (m) start = m.index + m[0].length;
    }
    return out;
}
