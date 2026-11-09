// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Reproducible proof through the compiled CLI and its real detached daemon.
// Everything (including trusted fixture code and durable sink) is temporary.
// We register through authenticated HTTP, append synthetic transcript records,
// then assert their IDs in the actual privacy-filtered destination log. Admission
// or idle status alone is not delivery proof. Separate assertions cover clean
// restart metadata/IDs, partial lines, blocked failures and graceful shutdown.
// Unlike the live harness, this writes only its own synthetic transcripts and
// deletes its fixtures. It does not prove production privacy, stories or Neumem.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { request as httpRequest } from "node:http";
import { GitStoryDaemonClient } from "../dist/daemonClient.js";

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, "../dist/cli.js");
const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "git-story-daemon-proof-"),
);
const repo = path.join(root, "repo");
const home = path.join(root, "home");
const stateDirectory = path.join(root, "state");
const fixture = path.join(root, "fixture");
const adapter = path.join(fixture, "adapter.mjs");
const env = {
    ...process.env,
    GIT_STORY_STATE_DIR: stateDirectory,
    GIT_STORY_COPILOT_HOME: home,
    GIT_STORY_PORT: "0",
    GIT_STORY_MAX_RECORDS: "2",
    GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"),
    GIT_CONFIG_NOSYSTEM: "1",
};
delete env.GIT_STORY_ADAPTER;
let currentClient;
let currentState;
const secret = "fixture-private-evidence";
const report = (message) => process.stdout.write(message + "\n");

async function run(args, input, expected = 0, visible = true) {
    if (visible) report(`> node dist/cli.js ${args.join(" ")}`);
    const child = execFile(process.execPath, [cli, ...args], {
        cwd: repo,
        env,
        encoding: "utf8",
        timeout: 20000,
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
    const result = await new Promise((resolve, reject) => {
        let stdout = "",
            stderr = "";
        child.stdout.on("data", (value) => {
            stdout += value;
        });
        child.stderr.on("data", (value) => {
            stderr += value;
        });
        child.once("error", reject);
        child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
    assert.equal(result.code, expected, `${args.join(" ")}: ${result.stderr}`);
    if (visible) report((result.stdout + result.stderr).trimEnd());
    return result;
}

async function connect() {
    currentState = JSON.parse(
        await fs.readFile(
            path.join(env.GIT_STORY_STATE_DIR, "daemon.json"),
            "utf8",
        ),
    );
    currentClient = new GitStoryDaemonClient(
        currentState.port,
        2000,
        currentState.token,
    );
    assert.equal((await currentClient.identity()).pid, currentState.pid);
}
async function until(predicate, label) {
    const deadline = Date.now() + 12000;
    while (!(await predicate())) {
        assert(Date.now() < deadline, `Timed out: ${label}`);
        await delay(30);
    }
}
async function rows(file = "sink.jsonl") {
    try {
        const text = await fs.readFile(path.join(fixture, file), "utf8");
        return text
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line));
    } catch (error) {
        if (error.code === "ENOENT") return [];
        throw error;
    }
}
async function events(file) {
    return (await rows(file)).flatMap((update) => update.events);
}
async function receipt(id) {
    return (await currentClient.sessions()).find(
        (item) => item.sessionId === id,
    );
}
const transcript = (id) =>
    path.join(home, ".copilot", "session-state", id, "events.jsonl");
const message = (id) => ({
    ...(id === undefined ? {} : { id }),
    type: "user.message",
    data: { content: secret },
});
async function append(id, ...records) {
    await fs.mkdir(path.dirname(transcript(id)), { recursive: true });
    await fs.appendFile(
        transcript(id),
        records.map((record) => JSON.stringify(record) + "\n").join(""),
    );
}
async function hook(id, command = "session-start") {
    const result = await run(
        ["hooks", "copilot", command],
        JSON.stringify({
            sessionId: id,
            cwd: repo,
            timestamp: Date.now(),
            source: "startup",
            initialPrompt: secret,
        }),
    );
    assert.equal(result.stdout, "{}\n");
    assert(!result.stderr.includes(secret));
    return result;
}
async function control(value) {
    await fs.writeFile(
        path.join(fixture, "control.json"),
        JSON.stringify(value),
    );
}
async function http(method, route, body, headers = {}) {
    return new Promise((resolve, reject) => {
        const request = httpRequest(
            {
                host: "127.0.0.1",
                port: currentState.port,
                path: route,
                method,
                headers: {
                    Authorization: `Bearer ${currentState.token}`,
                    "Content-Type": "application/json",
                    ...headers,
                },
            },
            (response) => {
                let text = "";
                response.on("data", (chunk) => {
                    text += chunk;
                });
                response.once("end", () =>
                    resolve({ status: response.statusCode, text }),
                );
            },
        );
        request.setTimeout(5000, () =>
            request.destroy(new Error("HTTP fixture timeout")),
        );
        request.once("error", reject);
        request.end(body);
    });
}

try {
    await Promise.all(
        [repo, home, fixture].map((dir) => fs.mkdir(dir, { recursive: true })),
    );
    await fs.copyFile(
        path.join(here, "fixtures", "daemonAdapter.mjs"),
        adapter,
    );
    await control({});
    await exec("git", ["init", "-q"], { cwd: repo, env });
    const settingsPath = path.join(
        repo,
        ".github",
        "copilot",
        "settings.local.json",
    );
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    const userHook = {
        type: "command",
        bash: "git story hooks copilot session-start",
        powershell: "user-owned-command",
    };
    await fs.writeFile(
        settingsPath,
        JSON.stringify({
            userSetting: "preserved",
            hooks: { sessionStart: [userHook] },
        }),
    );
    const userGitHook = path.join(repo, ".git", "hooks", "pre-commit");
    await fs.writeFile(userGitHook, "#!/bin/sh\n# user owned\n");
    await run(["init"], undefined, 1);
    await run(["init"], undefined, 1);
    const settings = JSON.parse(await fs.readFile(settingsPath, "utf8"));
    assert.equal(settings.userSetting, "preserved");
    assert.deepEqual(settings.hooks.sessionStart[0], userHook);
    assert.equal(settings.hooks.sessionStart.length, 2);
    assert.equal(
        await fs.readFile(userGitHook, "utf8"),
        "#!/bin/sh\n# user owned\n",
    );
    report(
        "INIT PASS: existing user settings/Copilot hook/git hook preserved; owned hooks idempotent.",
    );

    await run(["daemon", "start"]);
    await connect();
    await run(["daemon", "status"]);
    assert.equal((await currentClient.identity()).configured, false);
    const noConfig = await http(
        "POST",
        "/api/sessions",
        JSON.stringify({
            projectPath: repo,
            sessionId: "one",
            metadata: { clientName: "copilot-cli", models: [] },
        }),
    );
    assert.equal(noConfig.status, 503);
    report(`NO CONFIG: ${noConfig.status} ${noConfig.text}`);
    await assert.rejects(fs.stat(path.join(stateDirectory, "capture")), {
        code: "ENOENT",
    });
    await run(["daemon", "stop"]);

    env.GIT_STORY_ADAPTER = adapter;
    await Promise.all([run(["daemon", "start"]), run(["daemon", "start"])]);
    await connect();
    await run(["daemon", "status"]);
    await run(["daemon", "start"]);
    assert.equal((await currentClient.identity()).configured, true);
    await hook("one");
    await until(
        async () => (await receipt("one"))?.status?.phase === "waiting",
        "missing source waiting",
    );
    await run(["daemon", "sessions"]);
    await append(
        "one",
        {
            type: "session.start",
            data: { selectedModel: "history-model", parentSessionId: secret },
        },
        message("native-one"),
        message(),
        message(),
        message(),
    );
    await until(
        async () => (await events()).length === 5,
        "bounded initial drain",
    );
    await until(
        async () => (await receipt("one")).status.phase === "idle",
        "initial idle",
    );
    const initial = await events();
    assert.equal(initial[1].id, "native-one");
    assert.equal(new Set(initial.map((event) => event.id)).size, 5);
    assert((await rows()).every((update) => update.events.length <= 2));
    assert(!JSON.stringify(await rows()).includes(secret));
    report(
        `CAPTURE PASS: 5 events, max batch 2; native ID retained; generated IDs unique. Approved sample: ${JSON.stringify((await rows())[0])}`,
    );

    await hook("one");
    await hook("one", "agent-stop");
    await delay(150);
    assert.equal((await events()).length, 5);
    assert.equal((await receipt("one")).status.monitoring, true);
    await fs.appendFile(transcript("one"), JSON.stringify(message("partial")));
    await delay(1200);
    assert.equal((await events()).length, 5);
    await fs.appendFile(transcript("one"), "\n");
    await until(
        async () => (await events()).length === 6,
        "complete partial tail",
    );
    report(
        "TAIL/REPEAT PASS: partial tail withheld, newline delivered once; repeated hook and agent-stop do not duplicate or stop monitoring.",
    );

    await hook("two");
    await append("two", message("native-two"));
    await until(async () => (await events()).length === 7, "second session");
    assert.equal((await currentClient.sessions()).length, 2);
    report(
        "MULTI-SESSION PASS: same daemon independently monitors two sessions.",
    );

    const rejected = [
        [
            "unauthenticated",
            "POST",
            "/api/sessions",
            "{}",
            { Authorization: "" },
            401,
        ],
        [
            "origin",
            "GET",
            "/api/sessions",
            undefined,
            { Origin: "http://localhost" },
            403,
        ],
        [
            "rebinding",
            "GET",
            "/api/sessions",
            undefined,
            { Host: "attacker.example" },
            403,
        ],
        [
            "cross-site",
            "GET",
            "/api/sessions",
            undefined,
            { "Sec-Fetch-Site": "cross-site" },
            403,
        ],
        ["malformed", "POST", "/api/sessions", "{", {}, 400],
        [
            "content-type",
            "POST",
            "/api/sessions",
            "{}",
            { "Content-Type": "text/plain" },
            415,
        ],
        [
            "oversized",
            "POST",
            "/api/sessions",
            JSON.stringify({ data: "x".repeat(65536) }),
            {},
            413,
        ],
        ["method", "DELETE", "/api/sessions", undefined, {}, 405],
    ];
    for (const [label, method, route, body, headers, expected] of rejected) {
        const response = await http(method, route, body, headers);
        assert.equal(response.status, expected, label);
        report(`REJECT ${label}: ${response.status} ${response.text}`);
    }
    for (const sessionId of [
        "../escape",
        "x\\..\\escape",
        "C:\\absolute",
        "x:stream",
        "NUL",
        "bad.",
    ]) {
        const response = await http(
            "POST",
            "/api/sessions",
            JSON.stringify({
                projectPath: repo,
                sessionId,
                metadata: { clientName: "copilot-cli", models: [] },
            }),
        );
        assert.equal(response.status, 400);
    }
    report(
        "PATH PASS: traversal, Windows separator/absolute/ADS/device/trailing-dot inputs rejected.",
    );
    const malformed = await run(
        ["hooks", "copilot", "session-start"],
        '{"secret":"fixture-private-evidence"',
    );
    assert.equal(malformed.stdout, "{}\n");
    assert(!malformed.stderr.includes(secret));

    await control({ delayMs: 3000 });
    const attempted = (await events("attempts.jsonl")).length;
    await append("one", message("delayed"));
    await until(
        async () => (await events("attempts.jsonl")).length > attempted,
        "delayed destination entered",
    );
    const hookStart = Date.now();
    await hook("one");
    assert(Date.now() - hookStart < 2000, "Registration waited for delivery");
    assert(!(await events()).some((event) => event.id === "delayed"));
    await run(["daemon", "stop"]);
    assert((await events()).some((event) => event.id === "delayed"));
    const stoppedCount = (await events()).length;
    await append("one", message("after-stop"));
    await delay(1200);
    assert.equal((await events()).length, stoppedCount);
    await assert.rejects(fs.stat(path.join(stateDirectory, "daemon.json")), {
        code: "ENOENT",
    });
    report(
        "DRAIN PASS: hook returned while 3-second destination was pending; authenticated stop drained it, closed monitoring and removed owned state; later append not delivered.",
    );

    await control({});
    await run(["daemon", "start"]);
    await connect();
    await hook("one");
    await until(
        async () => (await events()).length === stoppedCount + 1,
        "restart new event only",
    );
    await until(
        async () => (await receipt("one")).status.phase === "idle",
        "restart idle",
    );
    const restored = (await rows()).at(-1);
    assert.deepEqual(restored.metadata.models, ["history-observed"]);
    assert.deepEqual(
        (await events()).slice(0, 5).map((event) => event.id),
        initial.map((event) => event.id),
    );
    assert.deepEqual(
        (await events()).slice(stoppedCount).map((event) => event.id),
        ["after-stop"],
    );
    report(
        "RESTART PASS: old metadata restored in batches of two; zero old-event replay; only after-stop delivered; previous native/generated IDs unchanged.",
    );

    await control({ fail: true });
    const beforeFailure = (await events()).length;
    await append("one", message(), message(), message("after-failure"));
    await until(
        async () =>
            (await receipt("one")).status?.failure?.stage === "delivery",
        "delivery failure receipt",
    );
    const failedReceipt = await receipt("one");
    const failure = failedReceipt.status.failure;
    assert.equal(failure.captureMayHaveAdvanced, true);
    const failedIds = (await rows("attempts.jsonl"))
        .at(-1)
        .events.map((event) => event.id);
    assert.equal(failedIds.length, 2);
    await hook("one");
    await delay(150);
    assert.equal((await events()).length, beforeFailure);
    await run(["daemon", "sessions"]);
    await run(["daemon", "stop"]);
    await control({});
    await run(["daemon", "start"]);
    await connect();
    await hook("one");
    assert.equal((await receipt("one")).recoveryRequired, true);
    assert.equal((await events()).length, beforeFailure);
    assert.equal((await receipt("one")).state, "blocked");
    const replay = await http("POST", "/api/sessions/replay", "{}");
    assert.equal(replay.status, 404);
    await run(["daemon", "replay"], undefined, 1);
    await append("one", message("still-blocked"));
    await delay(200);
    assert.equal((await events()).length, beforeFailure);
    assert.deepEqual((await receipt("one")).status.failure, failure);
    report(
        "FAILURE PASS: delivery failure remains visibly blocked after restart; removed replay API returns404 and CLI rejects replay; neither the undelivered batch nor later records are silently skipped or delivered. Manual reconciliation is required; automatic recovery is unsupported.",
    );

    await control({ delayMs: 3000 });
    const beforeInterruption = (await rows("attempts.jsonl")).length;
    await append("interrupted", message());
    await hook("interrupted");
    await until(
        async () => (await rows("attempts.jsonl")).length > beforeInterruption,
        "interrupted delivery",
    );
    const pendingEvents = (await rows("attempts.jsonl")).at(-1).events;
    assert.equal(pendingEvents.length, 1);
    const pendingReceipt = await receipt("interrupted");
    assert.equal(pendingReceipt.status.phase, "processing");
    const interruptedState = path.join(root, "interrupted-state");
    await fs.mkdir(interruptedState);
    // Real durable-state snapshot while the fixture destination is pending.
    // Only sessions/capture are copied, not runtime ownership or credentials.
    await fs.cp(
        path.join(stateDirectory, "sessions"),
        path.join(interruptedState, "sessions"),
        { recursive: true },
    );
    await fs.cp(
        path.join(stateDirectory, "capture"),
        path.join(interruptedState, "capture"),
        { recursive: true },
    );
    await run(["daemon", "stop"]);
    const beforeBlockedResume = (await events()).length;
    await control({});
    env.GIT_STORY_STATE_DIR = interruptedState;
    await run(["daemon", "start"]);
    await connect();
    await hook("interrupted");
    const interrupted = await receipt("interrupted");
    assert.equal(interrupted.recoveryRequired, true);
    assert.equal(interrupted.state, "blocked");
    assert.equal(interrupted.status.monitoring, false);
    await run(["daemon", "sessions"]);
    await append("interrupted", message("after-interruption"));
    await delay(200);
    assert.equal((await events()).length, beforeBlockedResume);
    report(
        "INTERRUPTION PASS: actual pending-delivery snapshot remains blocked after restart; appended records cannot silently resume past uncertain delivery. Supported clean restart/resume was verified separately.",
    );

    const explicit = path.join(home, "explicit-coverage.jsonl");
    const record = (id, type, data, extra = {}) => ({
        id,
        type,
        data,
        ...extra,
    });
    const coverageRecords = [
        record(
            "proof-answer",
            "assistant.message",
            {
                content: secret,
                turnId: "proof-turn",
                reasoningText: "OMITTED",
                attachments: [{ type: "file", path: secret }],
                citations: [{ url: secret }],
            },
            { parentId: "proof-parent" },
        ),
        record("proof-external", "external_tool.requested", {
            requestId: "proof-request",
            toolCallId: "proof-tool",
            toolName: "search",
            arguments: { query: secret },
            providerId: null,
        }),
        record("proof-receipt", "external_tool.completed", {
            requestId: "proof-request",
        }),
        record("proof-result", "tool.execution_complete", {
            toolCallId: "proof-tool",
            success: true,
            mcpMeta: { source: secret },
            result: { content: secret, mcpMeta: { source: secret } },
        }),
        record("proof-skill", "skill.invoked", {
            name: "fixture",
            content: secret,
        }),
        record("proof-notification", "system.notification", {
            kind: "warning",
            content: secret,
        }),
        record("proof-worker", "subagent.failed", {
            toolCallId: "proof-tool",
            error: secret,
        }),
        record("proof-chosen", "session.auto_mode_resolved", {
            chosenModel: "proof-chosen",
        }),
        record("proof-fallback", "session.fusion_route_failed", {
            fallbackModel: "proof-fallback",
            reason: secret,
        }),
        record("proof-noise", "assistant.reasoning", { content: "OMITTED" }),
        record("proof-noise2", "tool.execution_progress", {
            content: "OMITTED",
        }),
    ];
    await fs.writeFile(
        explicit,
        coverageRecords.map((event) => JSON.stringify(event) + "\n").join(""),
    );
    const coverageRegistration = {
        projectPath: repo,
        sessionId: "coverage",
        transcriptPath: explicit,
        metadata: {
            clientName: "copilot-cli",
            models: [],
            parentSessionId: "proof-parent",
            startedAt: "2026-10-06T08:00:00Z",
        },
    };
    const registered =
        await currentClient.registerSession(coverageRegistration);
    assert.equal(registered.transcriptPath, explicit);
    await until(async () => {
        const status = await receipt("coverage");
        return status.state === "active" && status.status?.phase === "idle";
    }, "expanded evidence through actual adapter");
    const coverageUpdates = (await rows()).filter(
        (update) => update.sessionId === "coverage",
    );
    const coverageEvents = coverageUpdates.flatMap((update) => update.events);
    assert.deepEqual(
        coverageEvents.map((event) => event.id),
        coverageRecords.slice(0, 9).map((event) => event.id),
    );
    assert.equal(coverageEvents[0].turnId, "proof-turn");
    assert.equal(coverageEvents[1].requestId, "proof-request");
    assert.deepEqual(coverageUpdates.at(-1).metadata.models, [
        "chosen-observed",
        "fallback-observed",
    ]);
    assert.equal((await receipt("coverage")).status.diagnosticCount, 0);
    assert(coverageUpdates.every((update) => update.events.length <= 2));
    for (const clientName of ["vscode-copilot", "unknown-client"]) {
        const response = await http(
            "POST",
            "/api/sessions",
            JSON.stringify({
                projectPath: repo,
                sessionId: "unsupported-native",
                transcriptPath: explicit,
                metadata: { clientName, models: [] },
            }),
        );
        assert.equal(
            response.status,
            clientName === "vscode-copilot" ? 503 : 400,
        );
        report(
            `REJECT ${clientName} explicit path: ${response.status} ${response.text}`,
        );
    }
    const vscodeHook = await run(
        ["hooks", "vscode", "session-start"],
        JSON.stringify({
            hook_event_name: "SessionStart",
            session_id: "unsupported-native",
            transcript_path: explicit,
        }),
    );
    assert.equal(vscodeHook.stdout, "{}\n");
    assert(
        vscodeHook.stderr.includes(
            "native transcript capture is not supported",
        ),
    );
    assert.equal(await receipt("unsupported-native"), undefined);
    report(
        "COVERAGE PASS: explicit Copilot CLI source -> authenticated daemon -> actual whole-update fixture privacy -> durable redacted sink; nine retained message/tool/skill/notification/subagent/model events, correlations and MCP evidence checked, two noise events omitted, zero diagnostics; VS Code hook preserved but incompatible capture fails closed.",
    );
    await run(["daemon", "stop"]);
    const beforeCoverageResume = (await events()).length;
    await fs.appendFile(
        explicit,
        JSON.stringify(message("proof-resume")) + "\n",
    );
    await run(["daemon", "start"]);
    await connect();
    await currentClient.registerSession(coverageRegistration);
    await until(async () => {
        const status = await receipt("coverage");
        return status.state === "active" && status.status?.phase === "idle";
    }, "expanded metadata restore");
    assert.deepEqual(
        (await events()).slice(beforeCoverageResume).map((event) => event.id),
        ["proof-resume"],
    );
    assert.deepEqual((await rows()).at(-1).metadata.models, [
        "chosen-observed",
        "fallback-observed",
    ]);
    assert.equal((await receipt("coverage")).status.diagnosticCount, 0);
    report(
        "COVERAGE RESUME PASS: explicit source re-registration restores chosen/fallback models, delivers only proof-resume, and does not republish prior evidence.",
    );
    await run(["daemon", "stop"]);
    await run(["daemon", "status"]);
    assert(!JSON.stringify(await rows()).includes(secret));
    report(
        "PASS: actual compiled CLI, detached daemon, authenticated HTTP, real hooks/watch/capture/normalization/metadata and fixture-only allow-list durable sink. No production privacy or extraction claim.",
    );
} finally {
    try {
        await connect();
        await run(["daemon", "stop"]);
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    await fs.rm(root, { recursive: true, force: true });
    report(
        "CLEANUP: isolated daemon stopped and all temporary fixture/state/transcript/repository files removed.",
    );
}
