// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { SkillGraph, expandHome, type BuildResult } from "./graph.js";
import type { Config, Diagnostic, Severity } from "./types.js";

// skillgraph CLI. Same engine as the LSP.
//
//   skillgraph check  [--root dir]... [--json] [--no-probe] [--only rule] [skill]
//   skillgraph graph  [--root dir]... [skill]            (JSON)
//   skillgraph refs   <target> [--root dir]...
//   skillgraph lsp    [--root dir]...                    (stdio)

const DEFAULT_ROOT = "~/.config/skillshare/skills";
const CONFIG_FILE = "skillgraph.json";
const EXIT_OK = 0;
const EXIT_ERRORS = 1;
const EXIT_USAGE = 2;
const SEVERITY_ORDER: Record<Severity, number> = { error: 0, warn: 1, info: 2 };

const USAGE = `skillgraph — deterministic semantic graph for Agent Skills

Usage:
  skillgraph check [skill] [--root DIR]... [--json] [--no-probe] [--only RULE] [--quiet]
  skillgraph graph [skill] [--root DIR]...
  skillgraph refs <target> [--root DIR]...
  skillgraph lsp [--root DIR]...

Roots default to skillgraph.json "roots" in the cwd, else ${DEFAULT_ROOT}.
`;

interface Args {
    cmd: string;
    positional: string[];
    roots: string[];
    json: boolean;
    probe: boolean;
    only?: string;
    quiet: boolean;
}

function parseArgs(argv: string[]): Args | undefined {
    const a: Args = {
        cmd: argv[0] ?? "",
        positional: [],
        roots: [],
        json: false,
        probe: true,
        quiet: false,
    };
    for (let i = 1; i < argv.length; i++) {
        const x = argv[i];
        if (x === "--root") a.roots.push(argv[++i]);
        else if (x === "--json") a.json = true;
        else if (x === "--no-probe") a.probe = false;
        else if (x === "--only") a.only = argv[++i];
        else if (x === "--quiet" || x === "-q") a.quiet = true;
        else if (x === "--stdio")
            continue; // LSP clients pass this
        else if (x.startsWith("-")) return undefined;
        else a.positional.push(x);
    }
    return a;
}

export function loadConfig(
    roots: string[],
    probe: boolean,
    cwd = process.cwd(),
): Config {
    if (roots.length)
        return { roots: roots.map((r) => path.resolve(expandHome(r))), probe };
    try {
        const file = JSON.parse(
            fs.readFileSync(path.join(cwd, CONFIG_FILE), "utf8"),
        );
        if (Array.isArray(file.roots)) {
            return {
                roots: file.roots.map((r: string) =>
                    path.resolve(cwd, expandHome(r)),
                ),
                probe,
            };
        }
    } catch {}
    return { roots: [expandHome(DEFAULT_ROOT)], probe };
}

function display(file: string, res: BuildResult): string {
    const skill = res.skills.find(
        (s) => file === s.dir || file.startsWith(s.dir + path.sep),
    );
    return skill ? `${skill.name}/${path.relative(skill.dir, file)}` : file;
}

function tag(d: Diagnostic): string {
    if (!d.spec) return "";
    const how =
        d.spec.source === "ast"
            ? "ast"
            : (d.spec.probe?.slice(-1)[0] ?? "help");
    return `  [${d.spec.source === "ast" ? d.spec.tool : `${d.spec.tool} ${d.spec.version}`} · ${how}]`;
}

const COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, s: string) =>
    COLOR ? `\x1b[${code}m${s}\x1b[0m` : s;
const SEV_COLOR: Record<Severity, string> = {
    error: "31",
    warn: "33",
    info: "36",
};

export async function main(argv: string[]): Promise<number> {
    const args = parseArgs(argv);
    if (!args || !["check", "graph", "refs", "lsp"].includes(args.cmd)) {
        process.stderr.write(USAGE);
        return args?.cmd === "" ||
            argv.includes("-h") ||
            argv.includes("--help")
            ? EXIT_OK
            : EXIT_USAGE;
    }
    const config = loadConfig(args.roots, args.probe);
    if (args.cmd === "lsp") {
        const { startServer } = await import("./server.js");
        startServer(config);
        return EXIT_OK;
    }
    const graph = new SkillGraph(config);
    const started = Date.now();
    const scope = args.cmd === "refs" ? undefined : args.positional[0];
    const res = config.probe
        ? await graph.buildWithProbes(scope)
        : graph.build(scope);

    if (args.cmd === "graph") {
        const out = {
            version: 1,
            nodes: res.nodes,
            edges: res.edges,
        };
        process.stdout.write(JSON.stringify(out, null, 2) + "\n");
        return EXIT_OK;
    }

    if (args.cmd === "refs") {
        // Target: skill name, rel path ("pr-review/scripts/x.py"), or "tool:gh".
        const t = args.positional[0];
        if (!t) {
            process.stderr.write(USAGE);
            return EXIT_USAGE;
        }
        const ids = new Set([
            t,
            `skill:${t}`,
            `doc:${t}`,
            `script:${t}`,
            `asset:${t}`,
            `tool:${t}`,
        ]);
        // A name can refer to several independently loaded skill scopes.
        const targets = new Set([t]);
        for (const skill of res.skills) {
            if (t === skill.name) targets.add(skill.id);
            else if (t.startsWith(`${skill.name}/`)) {
                targets.add(`${skill.id}/${t.slice(skill.name.length + 1)}`);
            }
        }
        for (const target of targets) {
            for (const kind of ["skill", "doc", "script", "asset"]) {
                ids.add(`${kind}:${target}`);
            }
        }
        const hits = res.edges.filter(
            (e) =>
                ids.has(e.to) ||
                [...targets].some(
                    (target) =>
                        e.to.startsWith(`heading:${target}#`) ||
                        e.to === `heading:${target}`,
                ),
        );
        for (const e of hits) {
            const extra = [...(e.words ?? []), ...(e.flags ?? [])].join(" ");
            process.stdout.write(
                `${display(e.at.file, res)}:${e.at.line}:${e.at.col}  ${e.kind}${extra ? `  ${extra}` : ""}\n`,
            );
        }
        return hits.length ? EXIT_OK : EXIT_ERRORS;
    }

    let diags = res.diagnostics.filter(
        (d) => !args.only || d.rule === args.only,
    );
    if (args.quiet) diags = diags.filter((d) => d.severity !== "info");
    diags.sort(
        (a, b) =>
            a.at.file.localeCompare(b.at.file) ||
            a.at.line - b.at.line ||
            a.at.col - b.at.col ||
            SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
    const errors = diags.filter((d) => d.severity === "error").length;
    if (args.json) {
        process.stdout.write(
            JSON.stringify(
                diags.map((d) => ({
                    ...d,
                    at: { ...d.at, display: display(d.at.file, res) },
                })),
                null,
                2,
            ) + "\n",
        );
    } else {
        for (const d of diags) {
            const loc = `${display(d.at.file, res)}:${d.at.line}:${d.at.col}`;
            process.stdout.write(
                `${paint("1", loc)}  ${paint(SEV_COLOR[d.severity], d.severity.padEnd(5))}  ${paint("2", d.rule.padEnd(19))} ${d.message}${paint("2", tag(d))}\n`,
            );
        }
        const warns = diags.filter((d) => d.severity === "warn").length;
        const infos = diags.length - errors - warns;
        const docs = res.docs.size;
        process.stdout.write(
            `\n${errors} errors, ${warns} warnings, ${infos} info · ${res.skills.filter((s) => !scope || s.name === scope).length} skills · ${docs} docs · ${res.edges.length} edges · ${Date.now() - started}ms\n`,
        );
    }
    return errors ? EXIT_ERRORS : EXIT_OK;
}
