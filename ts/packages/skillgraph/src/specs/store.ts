// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import type { CliSpec } from "../types.js";
import { sha8 } from "./hash.js";
import { normalizeHelp, parseHelp, parseVersion } from "./help.js";
import { identity, isShim, run, which, type Identity } from "./process.js";

// CLI specs for invoked commands.
//
//   bundled script ──static scan──▶ CliSpec{source:"ast"}   (never executed)
//   external tool  ──--help probe─▶ CliSpec{source:"help"}  (cached by binary identity)
//
// Probe pattern follows flyline: subcommand-aware, bounded, cached by
// realpath+size+mtime(+version), failures cached 1h, timeouts never cached.

const NEGATIVE_TTL_MS = 60 * 60 * 1000;
const CACHE_VERSION = 1;
/** Tools where `-h` is not help (human-readable sizes, etc.). */
const NO_SHORT_HELP = new Set(["ls", "df", "du", "sort", "free", "grep"]);
/** Tools never executed, even with --help. */
const NEVER_PROBE = new Set(["rm", "dd", "mkfs", "shutdown", "reboot", "kill"]);

interface CacheRecord {
    v: number;
    key: string;
    at: number;
    spec?: CliSpec;
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
