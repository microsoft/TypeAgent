// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const trustedCallbacks = new WeakSet();
export const isTrustedNormalHookCallback = (value) =>
    typeof value === "object" && value !== null && trustedCallbacks.has(value);
const samePath = (a, b) =>
    typeof a === "string" &&
    typeof b === "string" &&
    path.win32.normalize(a).toLowerCase() ===
        path.win32.normalize(b).toLowerCase();
const fail = (condition, message) => {
    if (!condition) throw new Error(message);
};

export function nativeInputIdentity(input) {
    fail(
        input &&
            typeof input.sessionId === "string" &&
            input.sessionId.length > 0,
        "Hook stdin session missing",
    );
    fail(
        typeof input.prompt === "string" &&
            input.prompt.length > 0 &&
            !/^\s*(?:\/|@typeagent\b)/iu.test(input.prompt),
        "Not an ordinary native hook input",
    );
    fail(
        typeof input.cwd === "string" && path.win32.isAbsolute(input.cwd),
        "Hook stdin cwd missing",
    );
    fail(
        Number.isFinite(input.timestamp) && input.timestamp > 0,
        "Hook stdin native timestamp missing",
    );
    const value = {
        sessionId: input.sessionId,
        prompt: input.prompt,
        cwd: input.cwd,
        timestamp: input.timestamp,
    };
    return {
        ...value,
        inputHash: digest(JSON.stringify(value)),
        rawPromptHash: digest(input.prompt),
    };
}

function identityMatches(a, b) {
    return (
        a?.ProcessId === b?.ProcessId &&
        a?.StartedMs === b?.StartedMs &&
        a?.ParentProcessId === b?.ParentProcessId &&
        samePath(a?.ExecutablePath, b?.ExecutablePath)
    );
}

function compiledRouterPeer(receipt, binding) {
    const candidates = (receipt.children ?? []).filter(
        (actor) =>
            actor.ParentProcessId === receipt.peer.ProcessId &&
            samePath(actor.ExecutablePath, binding.node.executable) &&
            actor.Arguments?.length === 2 &&
            samePath(actor.Arguments[0], binding.node.executable) &&
            samePath(actor.Arguments[1], binding.router.file),
    );
    fail(
        candidates.length === 1,
        "Missing/ambiguous actual compiled-router OS child",
    );
    const router = candidates[0];
    fail(
        router.StartedMs >= receipt.peer.StartedMs &&
            router.StartedMs <= receipt.observedAtMs &&
            router.ProcessId !== receipt.peer.ProcessId,
        "Compiled-router PID lifetime invalid",
    );
    return router;
}

function authenticPeer(receipt, binding) {
    fail(
        typeof binding.owner === "string" &&
            binding.owner.length > 0 &&
            typeof binding.ownedRoot === "string",
        "Owned callback binding missing",
    );
    for (const [file, expected] of [
        [
            binding.wrapper.file,
            path.join(
                binding.ownedRoot,
                "plugin",
                "macro-eval-native-hook.mjs",
            ),
        ],
        [
            binding.router.file,
            path.join(
                binding.ownedRoot,
                "plugin",
                "dist",
                "hooks",
                "hook-router.js",
            ),
        ],
    ]) {
        fail(
            samePath(file, expected) &&
                samePath(fs.realpathSync(file), expected),
            "Wrong physical staged hook root",
        );
    }
    if (binding.policy) {
        const expected = path.join(
            binding.ownedRoot,
            "plugin",
            "native-normal-hook-config.json",
        );
        fail(
            samePath(binding.policy.file, expected) &&
                samePath(fs.realpathSync(expected), expected) &&
                digest(fs.readFileSync(expected)) === binding.policy.sha256,
            "Owned hook policy source drift",
        );
        const policy = JSON.parse(fs.readFileSync(expected, "utf8"));
        fail(
            policy.owner === binding.owner && policy.pipe === binding.pipe,
            "Owned hook policy binding mismatch",
        );
    }
    fail(
        digest(fs.readFileSync(binding.serverSource.file)) ===
            binding.serverSource.sha256,
        "Trusted OS reader source drift",
    );
    fail(
        receipt.protocol === "native-hook-os-association-v1" &&
            receipt.osApi === "GetNamedPipeClientProcessId/SafePipeHandle",
        "Unsupported physical peer association",
    );
    fail(
        receipt.serverPid === binding.server.ProcessId &&
            receipt.pipe === binding.pipe,
        "Wrong owned reader/pipe",
    );
    fail(
        identityMatches(receipt.peer, receipt.peerAfter),
        "Stale/reused hook PID",
    );
    fail(
        Number.isSafeInteger(receipt.peer.ProcessId) &&
            receipt.peer.StartedMs >= binding.cli.StartedMs &&
            receipt.peer.StartedMs <= receipt.observedAtMs,
        "Hook peer birth invalid",
    );
    fail(
        samePath(receipt.peer.ExecutablePath, binding.node.executable),
        "Hook peer executable mismatch",
    );
    fail(
        digest(fs.readFileSync(binding.node.executable)) ===
            binding.node.sha256,
        "Node executable source drift",
    );
    fail(
        digest(fs.readFileSync(binding.wrapper.file)) ===
            binding.wrapper.sha256 &&
            digest(fs.readFileSync(binding.router.file)) ===
                binding.router.sha256,
        "Staged hook source drift",
    );
    fail(
        receipt.peer.Arguments?.length === 2 &&
            samePath(receipt.peer.Arguments[0], binding.node.executable) &&
            samePath(receipt.peer.Arguments[1], binding.wrapper.file),
        "Hook staged argv mismatch",
    );
    fail(
        Array.isArray(receipt.ancestry) &&
            identityMatches(receipt.ancestry[0], receipt.peer),
        "Hook ancestry peer missing",
    );
    const cliIndex = receipt.ancestry.findIndex((actor) =>
        identityMatches(actor, binding.cli),
    );
    fail(cliIndex > 0, "Hook not descended from exact owned CLI");
    for (let index = 0; index < cliIndex; index++)
        fail(
            receipt.ancestry[index].ParentProcessId ===
                receipt.ancestry[index + 1].ProcessId &&
                receipt.ancestry[index].StartedMs >=
                    receipt.ancestry[index + 1].StartedMs,
            "Broken owned CLI ancestry",
        );
    fail(
        digest(fs.readFileSync(binding.cli.ExecutablePath)) ===
            binding.cli.sha256,
        "Owned CLI executable drift",
    );
}

export function authenticateNormalHookReceipt(receipt, binding, target) {
    authenticPeer(receipt, binding);
    const routerPeer = compiledRouterPeer(receipt, binding);
    fail(
        receipt.packet?.protocol === "native-hook-stdin-v1" &&
            Object.keys(receipt.packet).sort().join(",") === "protocol,stdin",
        "Unexpected hook packet/identity claim",
    );
    const input = nativeInputIdentity(JSON.parse(receipt.packet.stdin));
    fail(
        input.sessionId === target.sessionId &&
            input.prompt === target.prompt &&
            samePath(input.cwd, target.cwd),
        "Cross-session/root/prompt hook input",
    );
    fail(
        input.timestamp >= target.submittedAtMs &&
            input.timestamp <= receipt.observedAtMs &&
            receipt.observedAtMs <= target.deadlineMs,
        "Stale or out-of-bound hook stdin",
    );
    fail(
        binding.mode === target.mode &&
            binding.configDigest === target.configDigest &&
            /^[a-f0-9]{64}$/u.test(binding.configDigest),
        "Hook mode/config digest mismatch",
    );
    return {
        protocol: "native-normal-hook-callback-v1",
        owner: binding.owner,
        input,
        peer: receipt.peer,
        routerPeer,
        osApi: receipt.osApi,
        reader: {
            ...binding.server,
            pipe: binding.pipe,
            sourceHash: binding.serverSource.sha256,
        },
        staged: {
            wrapper: binding.wrapper,
            router: binding.router,
            node: binding.node,
            policy: binding.policy ?? null,
        },
        mode: binding.mode,
        configDigest: binding.configDigest,
        observedAtMs: receipt.observedAtMs,
    };
}

function freezeTree(value) {
    if (value && typeof value === "object") {
        for (const nested of Object.values(value)) freezeTree(nested);
        Object.freeze(value);
    }
    return value;
}

const root = (event) => !event.agentId && !event.data?.parentToolCallId;

function ancestor(events, child, wanted) {
    const seen = new Set();
    let current = child;
    while (current?.parentId && !seen.has(current.parentId)) {
        if (current.parentId === wanted.id) return true;
        seen.add(current.parentId);
        current = events.find((event) => event.id === current.parentId);
    }
    return false;
}

export function correlateNormalHook(callback, events, consumed = new Set()) {
    const starts = events.filter((event) => {
        if (
            event.type !== "hook.start" ||
            event.data?.hookType !== "userPromptSubmitted" ||
            !root(event)
        )
            return false;
        try {
            return (
                nativeInputIdentity(event.data.input).inputHash ===
                callback.input.inputHash
            );
        } catch {
            return false;
        }
    });
    fail(
        starts.length === 1 &&
            typeof starts[0].data.hookInvocationId === "string",
        "Missing/ambiguous native normal hook.start",
    );
    const start = starts[0];
    const ends = events.filter(
        (event) =>
            event.type === "hook.end" &&
            root(event) &&
            event.data?.hookType === "userPromptSubmitted" &&
            event.data?.hookInvocationId === start.data.hookInvocationId,
    );
    fail(
        ends.length === 1 &&
            ends[0].data.success === true &&
            ancestor(events, ends[0], start),
        "Missing/ambiguous/failed native hook.end",
    );
    const users = events.filter(
        (event) =>
            event.type === "user.message" &&
            root(event) &&
            event.data?.content === callback.input.prompt &&
            ancestor(events, event, ends[0]),
    );
    fail(users.length === 1, "Missing/ambiguous causal root user prompt");
    const answers = events.filter(
        (event) =>
            event.type === "assistant.message" &&
            root(event) &&
            typeof event.data?.content === "string" &&
            !event.data?.toolRequests?.length &&
            ancestor(events, event, users[0]),
    );
    const terminals = answers.flatMap((answer) =>
        events
            .filter(
                (event) =>
                    event.type === "assistant.turn_end" &&
                    root(event) &&
                    event.data?.turnId === answer.data?.turnId &&
                    answer.data?.turnId !== undefined &&
                    ancestor(events, event, answer),
            )
            .map((terminal) => ({ answer, terminal })),
    );
    fail(
        terminals.length === 1,
        "Missing/ambiguous authoritative root completion",
    );
    const key = `${callback.input.sessionId}:${start.data.hookInvocationId}`;
    fail(!consumed.has(key), "Duplicate native normal callback");
    consumed.add(key);
    return {
        ...callback,
        native: {
            hookStartEventId: start.id,
            hookEndEventId: ends[0].id,
            hookInvocationId: start.data.hookInvocationId,
            rootUserEventId: users[0].id,
            answerEventId: terminals[0].answer.id,
            terminalEventId: terminals[0].terminal.id,
            turnId: terminals[0].answer.data.turnId,
        },
        handled: ends[0].data.output?.handled ?? null,
    };
}

export function createTrustedNormalHookReader({
    directory,
    binding,
    probe,
    state,
}) {
    fail(
        /^normal-hook(?:-\d+)?$/u.test(
            path.relative(binding.ownedRoot, directory),
        ) && samePath(fs.realpathSync(directory), directory),
        "Wrong physical trusted-reader directory",
    );
    const accepted = state?.accepted ?? new Set();
    const seenPeers = state?.seenPeers ?? new Set();
    return {
        read(target, events) {
            const current = probe(binding.server.ProcessId);
            fail(
                identityMatches(current, binding.server),
                "Owned OS reader lifetime changed",
            );
            fail(
                identityMatches(probe(binding.cli.ProcessId), binding.cli),
                "Owned CLI lifetime changed",
            );
            const files = fs
                .readdirSync(directory)
                .filter((file) => /^receipt-\d{4}\.json$/u.test(file));
            const candidates = files
                .map((file) => {
                    const full = path.join(directory, file);
                    fail(
                        samePath(fs.realpathSync(full), full),
                        "Trusted receipt physical path changed",
                    );
                    const raw = fs
                        .readFileSync(full, "utf8")
                        .replace(/^\uFEFF/u, "");
                    const receipt = JSON.parse(raw);
                    return { file: full, sourceHash: digest(raw), receipt };
                })
                .filter(({ receipt }) => {
                    const input = JSON.parse(receipt.packet.stdin);
                    return (
                        input.sessionId === target.sessionId &&
                        input.prompt === target.prompt &&
                        input.timestamp >= target.submittedAtMs &&
                        input.timestamp <= target.deadlineMs
                    );
                });
            fail(
                candidates.length === 1,
                "Missing/ambiguous physical normal-hook receipt",
            );
            const candidate = candidates[0];
            const key = `${candidate.receipt.peer.ProcessId}:${candidate.receipt.peer.StartedMs}`;
            fail(!seenPeers.has(key), "Reused normal-hook peer receipt");
            const callback = authenticateNormalHookReceipt(
                candidate.receipt,
                binding,
                target,
            );
            const result = correlateNormalHook(callback, events, accepted);
            seenPeers.add(key);
            const trusted = freezeTree(
                structuredClone({
                    ...result,
                    trustedReceipt: {
                        file: candidate.file,
                        sha256: candidate.sourceHash,
                    },
                    nativeSource:
                        "actual owned CLI persisted native events; no SDK field invented",
                }),
            );
            trustedCallbacks.add(trusted);
            return trusted;
        },
    };
}
