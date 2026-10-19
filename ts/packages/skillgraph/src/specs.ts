// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { CliSpec, FlagDef } from "./types.js";

// CLI specs for invoked commands.
//
//   bundled script ──static scan──▶ CliSpec{source:"ast"}   (never executed)
//   external tool  ──--help probe─▶ CliSpec{source:"help"}  (cached by binary identity)
//
// Probe pattern follows flyline: subcommand-aware, bounded, cached by
// realpath+size+mtime(+version), failures cached 1h, timeouts never cached.

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_OUTPUT_LIMIT = 64 * 1024;
const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const CACHE_VERSION = 1;
/** Tools where `-h` is not help (human-readable sizes, etc.). */
const NO_SHORT_HELP = new Set(["ls", "df", "du", "sort", "free", "grep"]);
/** Tools never executed, even with --help. */
const NEVER_PROBE = new Set(["rm", "dd", "mkfs", "shutdown", "reboot", "kill"]);

// ── Bundled scripts: static extraction ──────────────────────────────────

const PY_FLAG =
    /(?:add_argument|click\.option|typer\.Option)\(\s*((?:["'][^"']+["']\s*,\s*)*["'][^"']+["'])/g;
const PY_SUBPARSER = /add_parser\(\s*["']([\w-]+)["']/g;
const PY_CLICK_CMD = /@(?:\w+\.)?command\(\s*(?:name\s*=\s*)?["']([\w-]+)["']/g;
const JS_OPTION = /\.(?:option|requiredOption)\(\s*["'`]([^"'`]+)["'`]/g;
const JS_YARGS = /\.option\(\s*["'`]([\w-]+)["'`]\s*,\s*\{/g;
const JS_COMMAND = /\.command\(\s*["'`]([\w-]+)/g;
const PARSE_ARGS_FLAG = /["'`](--[a-z][\w-]*)["'`]/g;
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
    if (summary) spec.summary = summary;
    // Local imports may parse argv too (kit/audit.mjs reads --audit): flags are a subset.
    if (/(?:from|require\()\s*["']\.\.?\//.test(src)) spec.partial = true;
    return spec;
}

function sha8(s: string | Buffer): string {
    return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

// ── External tools: --help / --version probe ────────────────────────────

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
function normalizeHelp(out: string, words: string[]): string {
    let s = out;
    for (const w of words) s = s.split(w).join("");
    return s.replace(/\s+/g, " ").trim();
}

export function parseVersion(text: string): string | undefined {
    // "gh version 2.97.0 (…)", "multica v0.6.0-2849-g5a04abde4" → first x.y[.z][-pre]
    return /(?:^|[^\w.])v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)/.exec(text)?.[1];
}

interface Identity {
    real: string;
    size: number;
    mtimeMs: number;
}

interface CacheRecord {
    v: number;
    key: string;
    at: number;
    spec?: CliSpec;
}

const whichMemo = new Map<string, string | undefined>();

/** Clear PATH lookups; called at the start of each build. */
export function resetWhich() {
    whichMemo.clear();
}

export function which(tool: string): string | undefined {
    if (whichMemo.has(tool)) return whichMemo.get(tool);
    const found = whichUncached(tool);
    whichMemo.set(tool, found);
    return found;
}

function whichUncached(tool: string): string | undefined {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
        const p = path.join(dir, tool);
        try {
            fs.accessSync(p, fs.constants.X_OK);
            if (fs.statSync(p).isFile()) return p;
        } catch {}
    }
    return undefined;
}

/** Version-manager shims: one binary multiplexes many tools (mise → pytest, eslint). */
const SHIM_TARGETS = new Set([
    "mise",
    "asdf",
    "rustup",
    "proto",
    "volta",
    "pyenv",
    "rbenv",
    "nodenv",
]);

function isShim(bin: string): boolean {
    try {
        const target = path.basename(fs.realpathSync(bin));
        return SHIM_TARGETS.has(target) && path.basename(bin) !== target;
    } catch {
        return false;
    }
}

function identity(bin: string): Identity | undefined {
    try {
        const real = fs.realpathSync(bin);
        const st = fs.statSync(real);
        return { real, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
    } catch {
        return undefined;
    }
}

interface RunResult {
    out: string;
    code: number | null;
    timedOut: boolean;
}

/** Run with no stdin, a scrubbed env, a timeout, and an output cap. */
function run(bin: string, args: string[]): Promise<RunResult> {
    return new Promise((resolve) => {
        const env: Record<string, string> = {
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? os.homedir(),
            LANG: "C",
            NO_COLOR: "1",
            TERM: "dumb",
            PAGER: "cat",
            GH_PAGER: "cat",
            GIT_PAGER: "cat",
            CI: "1",
        };
        const child = spawn(bin, args, {
            stdio: ["ignore", "pipe", "pipe"],
            env,
        });
        let out = "";
        let timedOut = false;
        const onData = (d: Buffer) => {
            if (out.length < PROBE_OUTPUT_LIMIT) out += d.toString("utf8");
            if (out.length >= PROBE_OUTPUT_LIMIT) child.kill("SIGKILL");
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
        }, PROBE_TIMEOUT_MS);
        child.on("error", () => {
            clearTimeout(timer);
            resolve({ out: "", code: -1, timedOut: false });
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ out: out.slice(0, PROBE_OUTPUT_LIMIT), code, timedOut });
        });
    });
}

/**
 * Cache of probed specs. In-memory map in front of an on-disk JSON store at
 * ~/.cache/skillgraph/specs-v1/<sha>.json. `get` never blocks; `probe` does.
 */
export class SpecStore {
    private memory = new Map<string, CacheRecord>();
    private versions = new Map<string, Promise<string>>();
    private inflight = new Map<string, Promise<CliSpec | undefined>>();
    constructor(
        private dir = process.env.SKILLGRAPH_CACHE ??
            path.join(
                os.homedir(),
                ".cache",
                "skillgraph",
                `specs-v${CACHE_VERSION}`,
            ),
    ) {}

    /** Probe key, e.g. "/opt/homebrew/Cellar/gh/2.62.0/bin/gh|123|456|pr view". */
    private key(id: Identity, words: string[]): string {
        return `${id.real}|${id.size}|${id.mtimeMs}|${words.join(" ")}`;
    }

    /** Cached spec, or undefined (unknown) / null (probed: no help). */
    get(tool: string, words: string[]): CliSpec | null | undefined {
        const bin = which(tool);
        const id = bin && identity(bin);
        if (!id) return null;
        const key = this.key(id, words);
        const rec = this.memory.get(key) ?? this.readDisk(key);
        if (!rec) return undefined;
        if (!rec.spec && Date.now() - rec.at > NEGATIVE_TTL_MS)
            return undefined;
        return rec.spec ?? null;
    }

    isProbeable(tool: string): boolean {
        const bin = which(tool);
        return !NEVER_PROBE.has(tool) && bin !== undefined && !isShim(bin);
    }

    probe(tool: string, words: string[]): Promise<CliSpec | undefined> {
        const bin = which(tool);
        const id = bin && identity(bin);
        if (!bin || !id || NEVER_PROBE.has(tool) || isShim(bin))
            return Promise.resolve(undefined);
        const key = this.key(id, words);
        const existing = this.inflight.get(key);
        if (existing) return existing;
        const p = this.doProbe(tool, bin, id, words, key).finally(() =>
            this.inflight.delete(key),
        );
        this.inflight.set(key, p);
        return p;
    }

    private async doProbe(
        tool: string,
        bin: string,
        id: Identity,
        words: string[],
        key: string,
    ): Promise<CliSpec | undefined> {
        const version = await this.version(bin, id);
        const argSets = NO_SHORT_HELP.has(tool)
            ? [["--help"]]
            : [["--help"], ["-h"]];
        let sawTimeout = false;
        for (const a of argSets) {
            const r = await run(bin, [...words, ...a]);
            if (r.timedOut) sawTimeout = true;
            const parsed = parseHelp(r.out);
            if (parsed.flags.length || parsed.subcommands.length) {
                const spec: CliSpec = {
                    tool,
                    version,
                    source: "help",
                    probe: [...words, ...a],
                    flags: parsed.flags,
                    subcommands: parsed.subcommands,
                    expectsSubcommand:
                        parsed.expectsSubcommand &&
                        parsed.subcommands.length > 0,
                    helpHash: sha8(normalizeHelp(r.out, words)),
                };
                if (parsed.partial) spec.partial = true;
                this.put(key, spec);
                return spec;
            }
        }
        if (!sawTimeout) this.put(key, undefined);
        return undefined;
    }

    /** `--version`, then `-v`; first semver token, else binary hash. */
    private version(bin: string, id: Identity): Promise<string> {
        const vkey = `${id.real}|${id.size}|${id.mtimeMs}`;
        let p = this.versions.get(vkey);
        if (!p) {
            p = (async () => {
                for (const a of [["--version"], ["-v"]]) {
                    const r = await run(bin, a);
                    const v = parseVersion(
                        r.out.split("\n").slice(0, 3).join(" "),
                    );
                    if (v) return v;
                }
                const buf = fs.readFileSync(id.real);
                return `sha256:${sha8(buf)}`;
            })();
            this.versions.set(vkey, p);
        }
        return p;
    }

    private file(key: string) {
        return path.join(
            this.dir,
            `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.json`,
        );
    }

    private readDisk(key: string): CacheRecord | undefined {
        try {
            const rec = JSON.parse(
                fs.readFileSync(this.file(key), "utf8"),
            ) as CacheRecord;
            if (rec.v !== CACHE_VERSION || rec.key !== key) return undefined;
            this.memory.set(key, rec);
            return rec;
        } catch {
            return undefined;
        }
    }

    private put(key: string, spec: CliSpec | undefined) {
        const rec: CacheRecord = { v: CACHE_VERSION, key, at: Date.now() };
        if (spec) rec.spec = spec;
        this.memory.set(key, rec);
        try {
            fs.mkdirSync(this.dir, { recursive: true });
            fs.writeFileSync(this.file(key), JSON.stringify(rec));
        } catch {}
    }
}
