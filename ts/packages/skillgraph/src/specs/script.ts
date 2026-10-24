// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CliSpec, FlagDef } from "../types.js";
import { parse, type Grammar, type Node } from "../parsers.js";
import { sha8 } from "./hash.js";

// Bundled scripts: static flag extraction (never executed), via tree-sitter.
//   scripts/fetch.py ──argparse/click/commander/param()──▶ CliSpec{source:"ast"}

type Lang = "py" | "js" | "ts" | "sh" | "ps1";
const GRAMMAR: Record<Lang, Grammar> = {
    py: "python",
    js: "javascript",
    ts: "typescript",
    sh: "bash",
    ps1: "powershell",
};
const EXT: Record<string, Lang> = {
    ".py": "py",
    ".js": "js",
    ".mjs": "js",
    ".cjs": "js",
    ".ts": "ts",
    ".mts": "ts",
    ".sh": "sh",
    ".bash": "sh",
    ".ps1": "ps1",
};
/** Shebang interpreter → language: `#!/usr/bin/env python3` → py. */
const SHEBANG: [RegExp, Lang][] = [
    [/python/, "py"],
    [/node|deno|bun/, "js"],
    [/pwsh/, "ps1"],
    [/\b(ba|z)?sh\b/, "sh"],
];
/** Python calls whose string args are flags: argparse, click, typer. */
const PY_FLAG_CALLS = new Set(["add_argument", "option", "Option"]);
/** Python calls whose first string arg is a subcommand. */
const PY_SUBCOMMAND_CALLS = new Set(["add_parser", "command"]);
/** JS calls: commander/yargs `.option("-x, --xx <v>")`, `.command("go")`. */
const JS_FLAG_CALLS = new Set(["option", "requiredOption"]);
const JS_SUBCOMMAND_CALLS = new Set(["command"]);
/** Runtime argv sources for hand-rolled parsing. */
const ARGV = new Set(["process.argv", "Bun.argv", "Deno.args"]);
const FLAG = /^-{1,2}[A-Za-z][\w-]*$/;
/** about_CommonParameters: added to every [CmdletBinding()] script. */
const PS_COMMON_PARAMS = [
    "Debug",
    "ErrorAction",
    "ErrorVariable",
    "InformationAction",
    "InformationVariable",
    "OutBuffer",
    "OutVariable",
    "PipelineVariable",
    "ProgressAction",
    "Verbose",
    "WarningAction",
    "WarningVariable",
    "WhatIf",
    "Confirm",
];
const LICENSE_LINE = /^(Copyright|Licensed|-\*-)/;

function detect(file: string, src: string): Lang | undefined {
    const byExt = EXT[path.extname(file)];
    if (byExt) return byExt;
    const shebang = src.startsWith("#!") ? src.slice(0, src.indexOf("\n")) : "";
    return SHEBANG.find(([re]) => re.test(shebang))?.[1];
}

/** String literal contents, or undefined for non-literals (`f"{x}"` counts). */
function literal(n: Node | null): string | undefined {
    if (!n || (n.type !== "string" && n.type !== "template_string"))
        return undefined;
    if (n.descendantsOfType(["interpolation", "template_substitution"]).length)
        return undefined;
    return n.namedChildren
        .filter(
            (c) => c.type === "string_content" || c.type === "string_fragment",
        )
        .map((c) => c.text)
        .join("");
}

/** `a.b.name(...)` → "name"; `name(...)` → "name". */
function callee(call: Node): string | undefined {
    const fn = call.childForFieldName("function");
    if (!fn) return undefined;
    if (fn.type === "identifier") return fn.text;
    return (
        fn.childForFieldName("attribute") ?? fn.childForFieldName("property")
    )?.text;
}

function args(call: Node): Node[] {
    return call.childForFieldName("arguments")?.namedChildren ?? [];
}

interface Found {
    flags: [string, Node][];
    subcommands: string[];
    /** A real argv parser was found; otherwise flag rules are skipped. */
    structured: boolean;
}

function readPython(root: Node): Found {
    const out: Found = { flags: [], subcommands: [], structured: false };
    for (const call of root.descendantsOfType("call")) {
        const name = callee(call) ?? "";
        const strings = args(call).map(literal);
        if (PY_FLAG_CALLS.has(name)) {
            out.structured = true;
            for (const s of strings)
                if (s && FLAG.test(s)) out.flags.push([s, call]);
        } else if (PY_SUBCOMMAND_CALLS.has(name)) {
            // add_parser("go") or @cli.command(name="go")
            const kw = args(call).find(
                (a) =>
                    a.type === "keyword_argument" &&
                    a.childForFieldName("name")?.text === "name",
            );
            const s = kw ? literal(kw.childForFieldName("value")) : strings[0];
            if (s) out.subcommands.push(s);
        }
    }
    return out;
}

function readJs(root: Node): Found {
    const out: Found = { flags: [], subcommands: [], structured: false };
    const calls = root.descendantsOfType("call_expression");
    for (const call of calls) {
        const name = callee(call) ?? "";
        const [first, second] = args(call);
        const s = literal(first);
        if (!s) continue;
        if (JS_FLAG_CALLS.has(name)) {
            out.structured = true;
            if (second?.type === "object" && !s.startsWith("-")) {
                // yargs: .option("verbose", {...}) / .option("v", {...})
                out.flags.push([s.length === 1 ? `-${s}` : `--${s}`, call]);
            } else {
                // commander: "-x, --xx <value>"
                for (const part of s.split(/[\s,|]+/))
                    if (FLAG.test(part)) out.flags.push([part, call]);
            }
        } else if (JS_SUBCOMMAND_CALLS.has(name)) {
            out.subcommands.push(s.split(" ")[0]);
        }
    }
    if (out.structured) return out;
    // util.parseArgs({ options: { foo: { type: "string", short: "f" } } })
    for (const call of calls) {
        if (callee(call) !== "parseArgs") continue;
        for (const pair of call.descendantsOfType("pair")) {
            const key = pair.childForFieldName("key");
            const value = pair.childForFieldName("value");
            if (key?.text !== "options" || value?.type !== "object") continue;
            out.structured = true;
            for (const opt of value.namedChildren) {
                if (opt.type !== "pair") continue;
                const k = opt.childForFieldName("key")!;
                out.flags.push([`--${literal(k) ?? k.text}`, opt]);
                for (const p of opt.childForFieldName("value")?.namedChildren ??
                    [])
                    if (
                        p.type === "pair" &&
                        p.childForFieldName("key")?.text === "short"
                    ) {
                        const short = literal(p.childForFieldName("value"));
                        if (short) out.flags.push([`-${short}`, p]);
                    }
            }
        }
    }
    if (out.structured) return out;
    // Hand-rolled argv loops: every "--flag" literal compared against argv.
    const readsArgv = root
        .descendantsOfType("member_expression")
        .some((m) => ARGV.has(m.text));
    if (!readsArgv) return out;
    for (const s of root.descendantsOfType(["string", "template_string"])) {
        const v = literal(s);
        if (v?.startsWith("--") && FLAG.test(v)) {
            out.structured = true;
            out.flags.push([v, s]);
        }
    }
    return out;
}

function readPowerShell(root: Node): Found {
    const out: Found = { flags: [], subcommands: [], structured: false };
    // Only the script-level block; function param blocks are nested deeper.
    const block = root.namedChildren.find((c) => c.type === "param_block");
    if (!block) return out;
    out.structured = true;
    for (const p of block.descendantsOfType("script_parameter")) {
        const v = p.namedChildren.find((c) => c.type === "variable");
        if (v) out.flags.push([`-${v.text.replace(/^\$/, "")}`, p]);
    }
    const cmdletBinding = block
        .descendantsOfType("type_name")
        .some((t) => t.text.toLowerCase() === "cmdletbinding");
    if (cmdletBinding)
        for (const name of PS_COMMON_PARAMS)
            out.flags.push([`-${name}`, block]);
    return out;
}

function readBash(root: Node): Found {
    const out: Found = { flags: [], subcommands: [], structured: false };
    // case "$1" in -a|--all) … esac
    for (const item of root.descendantsOfType("case_item")) {
        for (const v of item.childrenForFieldName("value")) {
            const s = v.text.replace(/^["']|["']$/g, "");
            if (FLAG.test(s)) {
                out.structured = true;
                out.flags.push([s, v]);
            }
        }
    }
    return out;
}

const READERS: Record<Lang, (root: Node) => Found> = {
    py: readPython,
    js: readJs,
    ts: readJs,
    sh: readBash,
    ps1: readPowerShell,
};

/** First doc block: Python docstring, JSDoc, `<# #>`, or leading `#`/`//` lines. */
function summaryOf(root: Node): string | undefined {
    const docs: Node[] = [];
    for (const c of root.namedChildren) {
        if (c.type === "hash_bang_line") continue;
        if (c.type === "comment") {
            if (!c.text.startsWith("#!")) docs.push(c);
        } else if (
            !docs.length &&
            c.type === "expression_statement" &&
            // Python docstring only; JS "use strict" is also a string statement.
            c.firstNamedChild?.firstNamedChild?.type === "string_start"
        )
            return firstLine(literal(c.firstNamedChild) ?? "");
        else break;
    }
    return firstLine(docs.map((d) => d.text).join("\n"));
}

function firstLine(text: string): string | undefined {
    return text
        .split("\n")
        .map((l) =>
            l
                .trim()
                .replace(/^(<#|#>|\/\*\*?|\*\/|\*|\/\/|#)/, "")
                .replace(/(#>|\*\/)$/, "")
                .trim(),
        )
        .find((l) => l && !LICENSE_LINE.test(l));
}

/** Local imports may parse argv too (kit/audit.mjs reads --audit). */
function hasLocalImport(root: Node): boolean {
    return root
        .descendantsOfType(["import_statement", "call_expression"])
        .some((n) => {
            const src =
                n.type === "import_statement"
                    ? n.childForFieldName("source")
                    : callee(n) === "require"
                      ? args(n)[0]
                      : null;
            return literal(src ?? null)?.startsWith(".") ?? false;
        });
}

export function scriptSpec(file: string): CliSpec | undefined {
    let src: string;
    try {
        src = fs.readFileSync(file, "utf8");
    } catch {
        return undefined;
    }
    const lang = detect(file, src);
    const { found, summary, partial } = lang
        ? parse(GRAMMAR[lang], src, (root) => ({
              found: READERS[lang](root),
              summary: summaryOf(root),
              partial: hasLocalImport(root),
          }))
        : { found: undefined, summary: undefined, partial: false };
    const flags = new Map<string, FlagDef>();
    for (const [name, node] of found?.flags ?? [])
        if (!flags.has(name))
            flags.set(name, { name, line: node.startPosition.row + 1 });
    const spec: CliSpec = {
        tool: file,
        version: `sha256:${sha8(src)}`,
        source: "ast",
        probe: [],
        path: file,
        // No parser found → no flag knowledge; the checker skips flag rules.
        flags: found?.structured
            ? [...flags.values(), { name: "--help" }, { name: "-h" }]
            : [],
        subcommands: [...new Set(found?.subcommands)],
        expectsSubcommand: false,
    };
    if (lang === "ps1") spec.pwsh = true;
    if (summary) spec.summary = summary;
    if (partial) spec.partial = true;
    return spec;
}
