// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { watch, statSync, type FSWatcher } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import registerDebug from "debug";

const debug = registerDebug("agent-server:stale-build");

// Set once a newer build is detected on disk. Read by the connection handler
// to warn clients (on join) that this process is serving out-of-date code.
let staleDetected = false;

/**
 * True once the running server's own `dist/` has been rebuilt on disk after
 * this process started (i.e. it is now serving out-of-date code). Latches on
 * and never clears - a relaunched successor starts a fresh process with its
 * own baseline.
 */
export function isStaleBuild(): boolean {
    return staleDetected;
}

// Black text on a yellow background, bold - only emitted to a TTY so
// redirected logs (files, pipes) stay readable.
const YELLOW_BG = "\x1b[1;30;43m";
const RESET = "\x1b[0m";

/**
 * Print a hard-to-miss yellow banner announcing that the code on disk was
 * rebuilt while this process kept running the old build. One-shot: called
 * once, when staleness is first detected.
 */
function printStaleBanner(): void {
    const lines = [
        "STALE BUILD",
        "agent-server code on disk was rebuilt after this process started;",
        "this window is still running the OLD build.",
        "Restart to load the new code:  @server restart   (CLI: /restart)",
    ];

    if (process.stdout.isTTY !== true) {
        // No colors/box for non-interactive logs - just make it greppable.
        process.stderr.write(
            "\n" + lines.map((line) => `[stale-build] ${line}`).join("\n") + "\n\n",
        );
        return;
    }

    const width = Math.min(Math.max(process.stdout.columns ?? 80, 40), 100);
    const inner = width - 4; // "| " + " |"
    const bar = "-".repeat(width - 2);
    const pad = (s: string) => {
        const text = s.length > inner ? s.slice(0, inner - 3) + "..." : s;
        return "| " + text + " ".repeat(inner - text.length) + " |";
    };
    const box = ["+" + bar + "+", ...lines.map(pad), "+" + bar + "+"];
    process.stdout.write(
        "\n" + box.map((l) => `${YELLOW_BG}${l}${RESET}`).join("\n") + "\n\n",
    );
}

function tryWatch(
    dir: string,
    recursive: boolean,
    onChange: (event: string, filename: string | null) => void,
): FSWatcher | undefined {
    try {
        // persistent:false so this watcher never keeps the event loop alive.
        return watch(dir, { recursive, persistent: false }, onChange);
    } catch (e) {
        debug(`watch(${dir}, recursive=${recursive}) failed: ${e}`);
        return undefined;
    }
}

/**
 * Watch the running server's own `dist/` directory and print a one-shot
 * yellow banner the first time a newer build appears on disk. This catches
 * the common dev loop: rebuild the agent-server, but its already-running
 * process keeps serving the previously-loaded code.
 *
 * Scope: only the running package's own compiled output is watched. A rebuild
 * of a *dependency* package that does not also re-emit this package's `dist/`
 * won't trip the banner - matching "the agent server has been rebuilt".
 *
 * Best-effort: any failure to set up the watch is logged under
 * `agent-server:stale-build` and otherwise ignored - it must never take the
 * server down.
 *
 * @param entryUrl `import.meta.url` of the running entry module.
 */
export function startStaleBuildWatcher(entryUrl: string): void {
    let distDir: string;
    try {
        distDir = path.dirname(fileURLToPath(entryUrl));
    } catch (e) {
        debug(`could not resolve entry dir from ${entryUrl}: ${e}`);
        return;
    }

    // Baseline is "now", not the entry file's mtime: an incremental build that
    // re-emits a sibling file without touching the entry still counts as a
    // rebuild of code this process already loaded.
    const startMs = Date.now();
    let fired = false;
    let watcher: FSWatcher | undefined;

    const onChange = (_event: string, filename: string | null) => {
        if (fired || filename === null) {
            return;
        }
        const name = filename.toString();
        // Only compiled JS indicates rebuilt runtime code; ignore
        // .map/.d.ts/.tsbuildinfo churn.
        if (!name.endsWith(".js")) {
            return;
        }
        let mtimeMs: number;
        try {
            mtimeMs = statSync(path.join(distDir, name)).mtimeMs;
        } catch {
            // File may have been renamed/removed mid-build.
            return;
        }
        if (mtimeMs <= startMs) {
            return;
        }
        fired = true;
        staleDetected = true;
        debug(
            `stale build detected via ${name} (mtime ${mtimeMs} > ${startMs})`,
        );
        printStaleBanner();
        watcher?.close();
    };

    // Recursive first (covers dist subfolders); fall back to a flat watch on
    // hosts/older runtimes where recursive watching isn't supported.
    watcher =
        tryWatch(distDir, true, onChange) ?? tryWatch(distDir, false, onChange);
    if (watcher === undefined) {
        debug(`stale-build watcher not started for ${distDir}`);
        return;
    }
    debug(`watching ${distDir} for rebuilds (baseline ${startMs})`);
}
