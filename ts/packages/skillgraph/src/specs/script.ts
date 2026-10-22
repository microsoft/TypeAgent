// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import type { CliSpec, FlagDef } from "../types.js";
import { sha8 } from "./hash.js";

// Bundled scripts: static flag extraction (never executed).
//   scripts/fetch.py ──argparse/click/commander/param()──▶ CliSpec{source:"ast"}

const PY_FLAG =
    /(?:add_argument|click\.option|typer\.Option)\(\s*((?:["'][^"']+["']\s*,\s*)*["'][^"']+["'])/g;
const PY_SUBPARSER = /add_parser\(\s*["']([\w-]+)["']/g;
const PY_CLICK_CMD = /@(?:\w+\.)?command\(\s*(?:name\s*=\s*)?["']([\w-]+)["']/g;
const JS_OPTION = /\.(?:option|requiredOption)\(\s*["'`]([^"'`]+)["'`]/g;
const JS_YARGS = /\.option\(\s*["'`]([\w-]+)["'`]\s*,\s*\{/g;
const JS_COMMAND = /\.command\(\s*["'`]([\w-]+)/g;
const PARSE_ARGS_FLAG = /["'`](--[a-z][\w-]*)["'`]/g;
/** PowerShell `param(...)` entries: `[string]$Name`, `[switch] $DryRun`. */
const PS_PARAM_BLOCK = /\bparam\s*\(/i;
const PS_PARAM = /\[[\w.\[\]]+\]\s*\$(\w+)/g;
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
const SH_FLAG =
    /^\s*(?:\|?\s*)?(-{1,2}[a-zA-Z][\w-]*)(?:\s*\|\s*-{1,2}[\w-]+)*\s*\)/gm;

export function scriptSpec(file: string): CliSpec | undefined {
    let src: string;
    try {
        src = fs.readFileSync(file, "utf8");
    } catch {
        return undefined;
    }
    const ext = path.extname(file);
    const flags = new Map<string, FlagDef>();
    const subcommands = new Set<string>();
    const lineOf = (idx: number) => src.slice(0, idx).split("\n").length;
    const add = (name: string, idx: number) => {
        if (!flags.has(name)) flags.set(name, { name, line: lineOf(idx) });
    };
    const lang =
        ext === ".py" || /^#!.*python/.test(src)
            ? "py"
            : /\.(m?js|cjs|ts|mts)$/.test(ext) || /^#!.*node/.test(src)
              ? "js"
              : ext === ".sh" || /^#!.*(ba|z)?sh/.test(src)
                ? "sh"
                : ext === ".ps1" || /^#!.*pwsh/.test(src)
                  ? "ps1"
                  : undefined;
    let structured = false;
    if (lang === "py") {
        for (const m of src.matchAll(PY_FLAG)) {
            structured = true;
            for (const n of m[1].matchAll(/["']([^"']+)["']/g)) {
                if (n[1].startsWith("-")) add(n[1], m.index ?? 0);
            }
        }
        for (const m of src.matchAll(PY_SUBPARSER)) subcommands.add(m[1]);
        for (const m of src.matchAll(PY_CLICK_CMD)) subcommands.add(m[1]);
    } else if (lang === "js") {
        for (const m of src.matchAll(JS_OPTION)) {
            structured = true;
            for (const n of m[1].matchAll(/(-{1,2}[\w-]+)/g))
                add(n[1], m.index ?? 0);
        }
        for (const m of src.matchAll(JS_YARGS)) {
            structured = true;
            add(m[1].length === 1 ? `-${m[1]}` : `--${m[1]}`, m.index ?? 0);
        }
        for (const m of src.matchAll(JS_COMMAND)) subcommands.add(m[1]);
        if (!structured && /parseArgs\(|process\.argv/.test(src)) {
            // Hand-rolled parsing: every quoted "--flag" literal is a flag.
            for (const m of src.matchAll(PARSE_ARGS_FLAG)) {
                structured = true;
                add(m[1], m.index ?? 0);
            }
            for (const m of src.matchAll(
                /^\s*(\w[\w-]*)\s*:\s*\{\s*type\s*:/gm,
            )) {
                structured = true;
                add(`--${m[1]}`, m.index ?? 0);
            }
        }
    } else if (lang === "ps1") {
        // Script-level param block: the first `param(` up to its matching `)`.
        const start = src.search(PS_PARAM_BLOCK);
        if (start >= 0) {
            let depth = 0;
            let end = start;
            for (let k = src.indexOf("(", start); k < src.length; k++) {
                if (src[k] === "(") depth++;
                else if (src[k] === ")" && --depth === 0) {
                    end = k;
                    break;
                }
            }
            structured = true;
            for (const m of src.slice(start, end).matchAll(PS_PARAM)) {
                add(`-${m[1]}`, start + (m.index ?? 0));
            }
            if (/\[CmdletBinding\b/i.test(src)) {
                for (const p of PS_COMMON_PARAMS) add(`-${p}`, start);
            }
        }
    } else if (lang === "sh") {
        for (const m of src.matchAll(SH_FLAG)) {
            structured = true;
            add(m[1], m.index ?? 0);
        }
    }
    const doc =
        /^(?:#!.*\n)?\s*(?:"""|''')([\s\S]*?)(?:"""|''')/.exec(src) ??
        /^(?:#!.*\n)?\s*\/\*\*?([\s\S]*?)\*\//.exec(src) ??
        /^(?:#!.*\n)?((?:\s*(?:#|\/\/).*\n)+)/.exec(src);
    const summary = doc?.[1]
        .split("\n")
        .map((l) => l.replace(/^\s*(?:#|\/\/|\*)\s?/, "").trim())
        .find((l) => l && !/^(Copyright|Licensed|-\*-)/.test(l));
    const spec: CliSpec = {
        tool: file,
        version: `sha256:${sha8(src)}`,
        source: "ast",
        probe: [],
        path: file,
        // No parser found → no flag knowledge; the checker skips flag rules.
        flags: structured
            ? [...flags.values(), { name: "--help" }, { name: "-h" }]
            : [],
        subcommands: [...subcommands],
        expectsSubcommand: false,
    };
    if (lang === "ps1") spec.pwsh = true;
    if (summary) spec.summary = summary;
    // Local imports may parse argv too (kit/audit.mjs reads --audit): flags are a subset.
    if (/(?:from|require\()\s*["']\.\.?\//.test(src)) spec.partial = true;
    return spec;
}
