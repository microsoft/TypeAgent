// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { CliSpec, FlagDef } from "../types.js";

// `--help` text → flags + subcommands. Pure; no process execution.

/** Help that admits it is a subset, e.g. curl: "This is not the full help". */
const PARTIAL_HELP =
    /not the full help|--help (?:--)?all|help <category>|use "?\S+ help -a/i;
/** Usage line that declares a subcommand slot, e.g. "gh pr <command> [flags]". */
const USAGE_SUBCOMMAND =
    /<(?:sub)?command>|\[command\]|\bCOMMANDS?\b|^Commands:|<cmd>|\{[a-z][\w-]*(?:,[a-z][\w-]*)+\}/;
/** Subcommand row: "  pr:   Manage…", "  ls, list   List…", "  ado [options] [tool]   Azure…". */
const SUBCOMMAND_ROW =
    /^\s{2,}([a-z][\w-]*(?:,\s*[a-z][\w-]*)*)(?::?(?:\s{2,}\S|\s*$)|\s+[<[][^\n]*?\s{2,}\S)/;
/** Unindented section header: "Commands:", "CORE COMMANDS", "Options". */
const SECTION_HEADER = /^[A-Z][A-Za-z :&-]*:?$/;
const COMMANDS_HEADER = /commands?:?$/i;
/** Option row: "  -R, --repo string   Select…", "    --[no-]quiet". */
const OPTION_ROW =
    /^\s*((?:-{1,2}(?:\[no-\])?[A-Za-z0-9][\w-]*(?:\[?[= ][<[]?[\w|.:,-]+[>\]]?\]?)?(?:,\s*|\s+|$))+)/;

/** Parse help text into flags and subcommands. Pure; exported for tests. */
export function parseHelp(text: string): {
    flags: FlagDef[];
    subcommands: string[];
    expectsSubcommand: boolean;
    partial: boolean;
} {
    // Strip ANSI colors and man-page overstrike ("N\bNA\bAM\bME").
    const clean = text.replace(/\x1b\[[0-9;]*m/g, "").replace(/.\x08/g, "");
    const lines = clean.split("\n");
    const usage = lines.slice(0, 12).join("\n");
    // Commander/cobra put the slot in a section header ("Commands:", "CORE COMMANDS").
    const expectsSubcommand =
        USAGE_SUBCOMMAND.test(usage) ||
        /^[A-Za-z :&-]*\bcommands:?$/im.test(clean);
    const flags = new Map<string, FlagDef>();
    const subcommands = new Set<string>();
    let optionRows = 0;
    // Subcommand rows count only under a "Commands" header; rows under
    // "Arguments:"/"Options" are positionals or examples (`cmd "message"`).
    let inCommands = true;
    for (const raw of lines) {
        const line = raw.replace(/\s+$/, "");
        if (!line.trim()) continue;
        if (SECTION_HEADER.test(line)) {
            inCommands = COMMANDS_HEADER.test(line);
            continue;
        }
        const opt = OPTION_ROW.exec(line);
        if (opt) {
            optionRows++;
            const help = line.slice(opt[0].length).trim();
            for (const f of opt[1].matchAll(
                /(?:^|[\s,])(-{1,2})(\[no-\])?([A-Za-z0-9][\w-]*)/g,
            )) {
                const names = [`${f[1]}${f[3]}`];
                if (f[2]) names.push(`--no-${f[3]}`);
                for (const name of names) {
                    if (!flags.has(name))
                        flags.set(name, help ? { name, help } : { name });
                }
            }
            continue;
        }
        if (expectsSubcommand && inCommands) {
            const sub = SUBCOMMAND_ROW.exec(line);
            if (sub) for (const w of sub[1].split(/,\s*/)) subcommands.add(w);
        }
    }
    // Man pages and usage lines mention flags outside option rows
    // ("--staged is a synonym for --cached", "[--no-pager]"). Any mention counts.
    for (const m of clean.matchAll(/(?:^|[\s[(|,`'"])(--[A-Za-z0-9][\w-]*)/g)) {
        if (!flags.has(m[1])) flags.set(m[1], { name: m[1] });
    }
    // Usage-only help (BSD grep, tar) lists a subset of flags.
    const partial = PARTIAL_HELP.test(clean) || optionRows === 0;
    return {
        flags: [...flags.values()],
        subcommands: [...subcommands],
        expectsSubcommand,
        partial,
    };
}

/** Remove the probed words so "gh pr comments --help" ≈ "gh pr --help". */
export function normalizeHelp(out: string, words: string[]): string {
    let s = out;
    for (const w of words) s = s.split(w).join("");
    return s.replace(/\s+/g, " ").trim();
}

export function parseVersion(text: string): string | undefined {
    // "gh version 2.97.0 (…)", "multica v0.6.0-2849-g5a04abde4" → first x.y[.z][-pre]
    return /(?:^|[^\w.])v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/.exec(text)?.[1];
}

/** Same help text, or same parsed shape (help with probed words echoed back). */
export function sameHelp(a: CliSpec, b: CliSpec): boolean {
    if (a.helpHash === b.helpHash) return true;
    const shape = (s: CliSpec) =>
        JSON.stringify([s.subcommands, s.flags.map((f) => f.name)]);
    return shape(a) === shape(b);
}
