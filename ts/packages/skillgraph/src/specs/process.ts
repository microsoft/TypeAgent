// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// PATH lookup, binary identity, and sandboxed execution for probes.

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_OUTPUT_LIMIT = 64 * 1024;

export interface Identity {
    real: string;
    size: number;
    mtimeMs: number;
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

export function isShim(bin: string): boolean {
    try {
        const target = path.basename(fs.realpathSync(bin));
        return SHIM_TARGETS.has(target) && path.basename(bin) !== target;
    } catch {
        return false;
    }
}

export function identity(bin: string): Identity | undefined {
    try {
        const real = fs.realpathSync(bin);
        const st = fs.statSync(real);
        return { real, size: st.size, mtimeMs: Math.floor(st.mtimeMs) };
    } catch {
        return undefined;
    }
}

export interface RunResult {
    out: string;
    code: number | null;
    timedOut: boolean;
}

/** Run with no stdin, a scrubbed env, a timeout, and an output cap. */
export function run(bin: string, args: string[]): Promise<RunResult> {
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
