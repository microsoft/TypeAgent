// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/*
 * This starts an isolated compiled daemon and registers only the selected source
 * through its authenticated client. REGISTERED means accepted; LIVE means catch-up
 * finished and monitoring is on. Neither alone proves delivery.
 * Send an exact LIVE-WATCHER-CHECK- marker in your chat. Copilot writes the user
 * message to events.jsonl. A filesystem/stat signal queues watcher capture; it
 * reads the complete JSONL record, keeps its native ID, and normalizes the event
 * and metadata. The fixture privacy filter returns a sanitized approved update.
 * The actual approvedUpdateDestination appends/fsyncs its batch to batches.jsonl.
 * Only then does this harness read that destination receipt and print MARKER with
 * its native event ID and batch number. It never tails the source to print delivery
 * or echoes an expected marker. Every summary stays in the log, not just a tail.
 * This script never writes the transcript. liveSessionWatcherSmoke.mjs creates
 * synthetic messages and checks their IDs/text against these receipts instead.
 * Ctrl+C/timeout drains the daemon and keeps evidence. These structural summaries
 * prove this pipeline, not production privacy, story generation or Neumem.
 * The separate daemonIntegrationDemo.mjs also proves clean restart/resume.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const here = path.dirname(fileURLToPath(import.meta.url));
class GuidanceError extends Error {}
const help = `Fixture-only local live Session Watcher proof (not production privacy).
Usage: node scripts/liveSessionWatcherDemo.mjs --session <id> [options]
  --transcript <absolute-path>  Default: ~/.copilot/session-state/<id>/events.jsonl
  --output-dir <absolute-path>  Evidence directory (must not contain prior logs)
  --duration <seconds>          Finite run, 0 = until Ctrl+C (default: 0)
  --max-history-bytes <bytes>   Refuse larger initial history (default: 33554432)
  --batch-size <records>        Bounded capture batch, 1..1000 (default: 100)
  --help
All initial history within the byte limit is captured; nothing is silently skipped.
After LIVE readiness, send a user message exactly LIVE-WATCHER-CHECK-<unique-label>.
Every approved batch is saved; native-ID marker receipts print immediately.
Ctrl+C drains and preserves evidence; markers do not end the run.
Build first from ts/: pnpm exec fluid-build git-story -t build --dep
Synthetic proof: node scripts/liveSessionWatcherSmoke.mjs
`;

function options() {
    const { values } = parseArgs({
        options: {
            session: { type: "string" },
            transcript: { type: "string" },
            "output-dir": { type: "string" },
            duration: { type: "string", default: "0" },
            "max-history-bytes": { type: "string", default: "33554432" },
            "batch-size": { type: "string", default: "100" },
            help: { type: "boolean" },
        },
    });
    if (values.help) return undefined;
    if (
        !values.session ||
        !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(values.session) ||
        values.session.endsWith(".") ||
        /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(values.session)
    )
        throw new GuidanceError(
            "Supply --session with one safe Copilot session ID; no discovery is performed.",
        );
    for (const name of ["transcript", "output-dir"])
        if (values[name] && !path.isAbsolute(values[name]))
            throw new GuidanceError(`--${name} must be absolute.`);
    const duration = Number(values.duration);
    const history = Number(values["max-history-bytes"]);
    const batch = Number(values["batch-size"]);
    if (
        !Number.isSafeInteger(duration) ||
        duration < 0 ||
        duration > 86400 ||
        !Number.isSafeInteger(history) ||
        history < 1 ||
        !Number.isSafeInteger(batch) ||
        batch < 1 ||
        batch > 1000
    )
        throw new GuidanceError(
            "Use duration 0..86400, positive history bytes and batch-size 1..1000.",
        );
    return {
        session: values.session,
        transcript:
            values.transcript ??
            path.join(
                os.homedir(),
                ".copilot",
                "session-state",
                values.session,
                "events.jsonl",
            ),
        output: values["output-dir"],
        duration,
        history,
        batch,
    };
}

async function run(config) {
    const main = path.resolve(here, "../dist/daemonMain.js");
    const clientModule = path.resolve(here, "../dist/daemonClient.js");
    try {
        await fs.access(main);
        await fs.access(clientModule);
    } catch {
        throw new GuidanceError(
            "Compiled daemon missing. From ts/ run: pnpm exec fluid-build git-story -t build --dep",
        );
    }
    let initialSize = 0;
    try {
        initialSize = (await fs.stat(config.transcript)).size;
    } catch (error) {
        if (error.code !== "ENOENT")
            throw new GuidanceError(
                "Cannot access selected transcript. Check --transcript and permissions.",
            );
    }
    if (initialSize > config.history)
        throw new GuidanceError(
            "Initial transcript exceeds --max-history-bytes. Increase that explicit limit to capture all history.",
        );
    const output =
        config.output ??
        (await fs.mkdtemp(path.join(os.tmpdir(), "git-story-live-evidence-")));
    await fs.mkdir(output, { recursive: true, mode: 0o700 });
    for (const name of ["batches.jsonl", "receipts.jsonl", "proof.jsonl"]) {
        const handle = await fs.open(path.join(output, name), "wx", 0o600);
        await handle.close();
    }
    const report = async (kind, detail = {}) => {
        const text = JSON.stringify({
            time: new Date().toISOString(),
            kind,
            ...detail,
        });
        await fs.appendFile(path.join(output, "proof.jsonl"), text + "\n");
        process.stdout.write(text + "\n");
    };
    const operational = await fs.mkdtemp(
        path.join(os.tmpdir(), "git-story-live-state-"),
    );
    const stateFile = path.join(operational, "daemon.json");
    const { GitStoryDaemonClient } = await import(
        new URL("../dist/daemonClient.js", import.meta.url)
    );
    let stopRequested = false,
        exited = false,
        exitCode;
    const signal = () => {
        stopRequested = true;
    };
    process.on("SIGINT", signal);
    process.on("SIGTERM", signal);
    let child, client;
    let logOffset = 0,
        tail = "",
        batches = 0,
        events = 0,
        markers = 0;
    const readBatches = async () => {
        const handle = await fs.open(path.join(output, "batches.jsonl"), "r");
        try {
            const buffer = Buffer.alloc(64 * 1024);
            for (;;) {
                const { bytesRead } = await handle.read(
                    buffer,
                    0,
                    buffer.length,
                    logOffset,
                );
                if (!bytesRead) break;
                logOffset += bytesRead;
                tail += buffer.toString("utf8", 0, bytesRead);
                let end;
                while ((end = tail.indexOf("\n")) >= 0) {
                    const row = JSON.parse(tail.slice(0, end));
                    tail = tail.slice(end + 1);
                    batches++;
                    events += row.eventCount;
                    for (const event of row.events) {
                        if (!event.marker) continue;
                        markers++;
                        await report("MARKER", {
                            batch: row.batch,
                            nativeId: event.nativeId,
                            id: event.id,
                            marker: event.marker,
                            log: "batches.jsonl",
                        });
                    }
                }
            }
        } finally {
            await handle.close();
        }
    };
    try {
        await report("CONFIG", {
            session: config.session,
            transcript: config.transcript,
            evidence: output,
            state: operational,
            port: "ephemeral loopback",
            initialBytes: initialSize,
            maxHistoryBytes: config.history,
            batchSize: config.batch,
            privacy:
                "fixture structural allowlist; exact marker user text only",
        });
        child = spawn(process.execPath, [main], {
            cwd: path.resolve(here, ".."),
            windowsHide: true,
            env: {
                ...process.env,
                GIT_STORY_STATE_DIR: operational,
                GIT_STORY_PORT: "0",
                GIT_STORY_MAX_RECORDS: String(config.batch),
                GIT_STORY_ADAPTER: path.join(
                    here,
                    "fixtures",
                    "liveSessionAdapter.mjs",
                ),
                GIT_STORY_LIVE_OUTPUT: output,
            },
            stdio: ["ignore", "ignore", "ignore"],
        });
        child.on("error", () => {
            exited = true;
            exitCode = 1;
        });
        child.on("exit", (code) => {
            exited = true;
            exitCode = code;
        });
        const startup = Date.now() + 10000;
        while (!client) {
            if (exited || Date.now() > startup)
                throw new GuidanceError(
                    "Isolated daemon startup failed; build and local state permissions must be valid.",
                );
            let state;
            try {
                state = JSON.parse(await fs.readFile(stateFile, "utf8"));
            } catch (error) {
                if (error.code !== "ENOENT") throw error;
            }
            if (state) {
                const connected = new GitStoryDaemonClient(
                    state.port,
                    2000,
                    state.token,
                );
                if ((await connected.identity()).pid !== child.pid)
                    throw new GuidanceError("Unexpected daemon owner.");
                client = connected;
            } else await delay(50);
        }
        async function monitor() {
            const accepted = await client.registerSession({
                sessionId: config.session,
                transcriptPath: config.transcript,
                projectPath: path.resolve(here, ".."),
                metadata: { clientName: "copilot-cli", models: [] },
            });
            await report("REGISTERED", { state: accepted.state });
            const deadline = config.duration
                ? Date.now() + config.duration * 1000
                : Infinity;
            const reported = new Set();
            let lastSummary = 0;
            while (!stopRequested && Date.now() < deadline) {
                if (exited)
                    throw new GuidanceError(
                        "Isolated daemon exited before shutdown.",
                    );
                const receipt = (await client.sessions())[0];
                const label = receipt.recoveryRequired
                    ? "BLOCKED"
                    : receipt.status?.phase === "waiting"
                      ? "WAITING"
                      : receipt.state === "active" &&
                          receipt.status?.phase === "idle" &&
                          receipt.status.monitoring
                        ? "LIVE"
                        : "CATCH_UP";
                await readBatches();
                if (!reported.has(label)) {
                    await report(label, {
                        batches,
                        events,
                        markers,
                        ...(label === "WAITING"
                            ? {
                                  guidance:
                                      "Selected transcript missing; check session ID/path or wait for creation.",
                              }
                            : {}),
                    });
                    reported.add(label);
                }
                if (Date.now() - lastSummary >= 2000) {
                    await fs.appendFile(
                        path.join(output, "receipts.jsonl"),
                        JSON.stringify(receipt) + "\n",
                    );
                    await report("TOTALS", {
                        batches,
                        events,
                        markers,
                        phase: receipt.status?.phase,
                        readByteOffset:
                            receipt.status?.readCheckpoint?.sourceByteOffset,
                        diagnostics: receipt.status?.diagnosticCount ?? 0,
                    });
                    lastSummary = Date.now();
                }
                if (receipt.recoveryRequired)
                    throw new GuidanceError(
                        "Source is blocked. No supported automatic recovery; preserve evidence.",
                    );
                await delay(200);
            }
        }
        try {
            await monitor();
        } catch (error) {
            // Ctrl+C may also reach the child console and close its HTTP server.
            if (!stopRequested) throw error;
        }
    } finally {
        // Evidence failures must not prevent stopping the owned daemon.
        async function cleanupEvidence(write) {
            try {
                await write();
            } catch {
                process.stderr.write(
                    "Shutdown evidence write failed; daemon cleanup continues.\n",
                );
                process.exitCode = 1;
            }
        }
        async function shutdown() {
            await cleanupEvidence(() => report("STOPPING"));
            if (client && !exited) {
                await cleanupEvidence(async () => {
                    // Ctrl+C can already have closed the child HTTP server.
                    if (!stopRequested)
                        await fs.appendFile(
                            path.join(output, "receipts.jsonl"),
                            JSON.stringify((await client.sessions())[0]) + "\n",
                        );
                });
                try {
                    await client.stop();
                } catch {
                    if (!stopRequested) {
                        process.stderr.write(
                            "Daemon stop request failed; waiting for owned shutdown without force kill.\n",
                        );
                        process.exitCode = 1;
                        await cleanupEvidence(() =>
                            report("STOP_REQUEST_FAILED", {
                                guidance:
                                    "Inspect isolated ownership state; no force kill performed.",
                            }),
                        );
                    }
                }
            }
            const deadline = Date.now() + 15000;
            while (child && !exited && Date.now() < deadline) await delay(50);
            if (child && !exited) {
                child.unref();
                await cleanupEvidence(() =>
                    report("STILL_STOPPING", {
                        state: operational,
                        guidance:
                            "Ownership retained; no force kill performed.",
                    }),
                );
                process.exitCode = 1;
            } else {
                await cleanupEvidence(readBatches);
                if (client)
                    await cleanupEvidence(() =>
                        report("STOPPED", {
                            batches,
                            events,
                            markers,
                            exitCode,
                        }),
                    );
                if (exitCode !== undefined && exitCode !== 0)
                    process.exitCode = 1;
                await fs.rm(operational, { recursive: true, force: true });
            }
        }
        try {
            await shutdown();
        } finally {
            process.removeListener("SIGINT", signal);
            process.removeListener("SIGTERM", signal);
            await cleanupEvidence(() =>
                report("EVIDENCE", { directory: output }),
            );
        }
    }
}

try {
    const config = options();
    if (!config) process.stdout.write(help);
    else await run(config);
} catch (error) {
    // Only our deliberate guidance is shown; no raw filesystem/adapter errors.
    process.stderr.write(
        error instanceof GuidanceError
            ? `${error.message}\n`
            : "Live proof failed; check paths, build and evidence directory permissions.\n",
    );
    process.exitCode = 1;
}
