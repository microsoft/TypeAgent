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
/** argparse actions that take no value: `--dry` alone. */
const PY_SWITCH_ACTIONS = new Set([
    "store_true",
    "store_false",
    "store_const",
    "append_const",
    "count",
    "help",
    "version",
]);
/** Calls that declare a parser; flags are ambiguous when a file has several. */
const PY_PARSER_CALLS = new Set(["ArgumentParser", "command", "group"]);
/** Positional declarations: argparse add_argument("x"), click argument("x"). */
const PY_POSITIONAL_CALLS = new Set(["add_argument", "argument"]);
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

/** What a definition says about its argument: required, allowed values, arity. */
type ArgMeta = Pick<FlagDef, "required" | "choices" | "takesValue">;

interface Found {
    flags: [string, Node, ArgMeta?][];
    /** Positional slots; undefined once one is optional or variadic. */
    positionals?: number | undefined;
    /** Parser declarations (ArgumentParser, click command); >1 means unknown scope. */
    parsers: number;
    subcommands: string[];
    /** A real argv parser was found; otherwise flag rules are skipped. */
    structured: boolean;
}

/** Keyword arguments of a call: `required=True` → {required: Node}. */
function kwargs(call: Node): Map<string, Node> {
    const out = new Map<string, Node>();
    for (const a of args(call))
        if (a.type === "keyword_argument") {
            const k = a.childForFieldName("name")?.text;
            const v = a.childForFieldName("value");
            if (k && v) out.set(k, v);
        }
    return out;
}

/** `["a", "b"]` or `click.Choice(["a", "b"])` → ["a", "b"]; undefined if not all literals. */
function stringList(n: Node | undefined): string[] | undefined {
    if (n?.type === "call") n = args(n)[0];
    if (!n || (n.type !== "list" && n.type !== "tuple")) return undefined;
    const items = n.namedChildren.map(literal);
    return items.every((i) => i !== undefined)
        ? (items as string[])
        : undefined;
}

function pyMeta(call: Node): ArgMeta {
    const kw = kwargs(call);
    const meta: ArgMeta = {};
    if (kw.get("required")?.text === "True") meta.required = true;
    const choices = stringList(kw.get("choices") ?? kw.get("type"));
    if (choices) meta.choices = choices;
    const action = literal(kw.get("action") ?? null);
    if (
        (action && PY_SWITCH_ACTIONS.has(action)) ||
        kw.get("is_flag")?.text === "True" ||
        kw.get("count")?.text === "True"
    )
        meta.takesValue = false;
    else if (!action && !kw.has("nargs")) meta.takesValue = true;
    return meta;
}

function readPython(root: Node): Found {
    const out: Found = {
        flags: [],
        subcommands: [],
        structured: false,
        positionals: 0,
        parsers: 0,
    };
    for (const call of root.descendantsOfType("call")) {
        const name = callee(call) ?? "";
        const strings = args(call).map(literal);
        if (PY_PARSER_CALLS.has(name)) out.parsers++;
        if (
            PY_POSITIONAL_CALLS.has(name) &&
            strings[0] &&
            !strings[0].startsWith("-")
        ) {
            // add_argument("target"): one slot unless nargs/required=False.
            const kw = kwargs(call);
            if (
                out.positionals !== undefined &&
                !kw.has("nargs") &&
                kw.get("required")?.text !== "False"
            )
                out.positionals++;
            else out.positionals = undefined;
            continue;
        }
        if (PY_FLAG_CALLS.has(name)) {
            out.structured = true;
            const meta = pyMeta(call);
            for (const s of strings)
                if (s && FLAG.test(s)) out.flags.push([s, call, meta]);
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
    const out: Found = {
        flags: [],
        subcommands: [],
        structured: false,
        parsers: 1,
    };
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
                // commander: "-x, --xx <value>"; requiredOption must be given.
                // "<v>" takes a value, "[v]" maybe, none is a switch.
                const meta: ArgMeta = {};
                if (/<[^>]+>/.test(s)) meta.takesValue = true;
                else if (!/\[[^\]]+\]/.test(s)) meta.takesValue = false;
                if (name === "requiredOption") meta.required = true;
                for (const part of s.split(/[\s,|]+/))
                    if (FLAG.test(part)) out.flags.push([part, call, meta]);
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

/** `[Parameter(Mandatory)]`, `[ValidateSet('a','b')]`, `[switch]` on one parameter. */
function psMeta(p: Node): ArgMeta {
    const meta: ArgMeta = { takesValue: true };
    for (const a of p.descendantsOfType("attribute")) {
        const name = a
            .descendantsOfType("type_identifier")[0]
            ?.text.toLowerCase();
        const argList = a.descendantsOfType("attribute_argument");
        if (name === "switch") meta.takesValue = false;
        else if (name === "parameter") {
            // Mandatory, Mandatory=$true; not Mandatory=$false.
            if (
                argList.some(
                    (x) =>
                        /^mandatory$/i.test(x.namedChildren[0]?.text ?? "") &&
                        !/\$false/i.test(x.text),
                )
            )
                meta.required = true;
        } else if (name === "validateset") {
            const vals = argList.map(
                (x) => /^(['"])(.*)\1$/.exec(x.text.trim())?.[2],
            );
            if (vals.length && vals.every((v) => v !== undefined))
                meta.choices = vals as string[];
        }
    }
    return meta;
}

function readPowerShell(root: Node): Found {
    const out: Found = {
        flags: [],
        subcommands: [],
        structured: false,
        parsers: 1,
    };
    // Only the script-level block; function param blocks are nested deeper.
    const block = root.namedChildren.find((c) => c.type === "param_block");
    if (!block) return out;
    out.structured = true;
    for (const p of block.descendantsOfType("script_parameter")) {
        const v = p.namedChildren.find((c) => c.type === "variable");
        if (v) out.flags.push([`-${v.text.replace(/^\$/, "")}`, p, psMeta(p)]);
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
    const out: Found = {
        flags: [],
        subcommands: [],
        structured: false,
        parsers: 1,
    };
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
    // Subcommands or several parsers: a required flag may belong to another
    // parser, so keep names only.
    const scoped = !!found && found.parsers <= 1 && !found.subcommands.length;
    for (const [name, node, meta] of found?.flags ?? [])
        if (!flags.has(name))
            flags.set(name, {
                name,
                line: node.startPosition.row + 1,
                ...(scoped
                    ? meta
                    : meta?.takesValue !== undefined
                      ? { takesValue: meta.takesValue }
                      : {}),
            });
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
    if (scoped && found.positionals !== undefined)
        spec.positionals = found.positionals;
    if (summary) spec.summary = summary;
    if (partial) spec.partial = true;
    return spec;
}
