// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { watch, statSync, type FSWatcher } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import registerDebug from "debug";

import { printWarningBanner } from "./banner.js";

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

type StaleDetail = {
    // The rebuilt .js file that tripped detection.
    filename: string;
    // Watch baseline: when this running worker started watching (its "current"
    // build reference).
    baselineMs: number;
    // mtime of the newer file found on disk (the "detected" build).
    mtimeMs: number;
};

// Wall-clock HH:MM:SS.mmm. Both stamps are from the same run, so the date is
// redundant; millis matter for spotting sub-second build races.
function formatClock(ms: number): string {
    const d = new Date(ms);
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return (
        `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
        `.${pad(d.getMilliseconds(), 3)}`
    );
}

/**
 * Print a hard-to-miss yellow banner announcing that the code on disk was
 * rebuilt while this process kept running the old build. One-shot: called
 * once, when staleness is first detected. Includes the baseline-vs-detected
 * timestamps (and which file) so a spurious trip - e.g. a build still writing
 * dist just after this worker relaunched - is easy to spot.
 */
function printStaleBanner(detail: StaleDetail): void {
    const deltaS = ((detail.mtimeMs - detail.baselineMs) / 1000).toFixed(1);
    printWarningBanner(
        [
            "STALE BUILD",
            "agent-server code on disk was rebuilt after this process started;",
            "this window is still running the OLD build.",
            `  rebuilt +${deltaS}s after start:  ${detail.filename}`,
            `    baseline ${formatClock(detail.baselineMs)}  ->  file mtime ${formatClock(detail.mtimeMs)}`,
            "Restart to load the new code:  @server restart   (CLI: /restart)",
        ],
        "stale-build",
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
 * @param onStale  Optional callback invoked once, when staleness is first
 *   detected - used to push the notice to already-connected clients.
 */
export function startStaleBuildWatcher(
    entryUrl: string,
    onStale?: () => void,
): void {
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
        printStaleBanner({ filename: name, baselineMs: startMs, mtimeMs });
        watcher?.close();
        // Push the notice to already-connected clients (not just ones that
        // join after this point).
        if (onStale !== undefined) {
            try {
                onStale();
            } catch (e) {
                debug(`onStale callback threw: ${e}`);
            }
        }
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
