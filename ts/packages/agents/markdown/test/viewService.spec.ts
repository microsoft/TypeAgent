// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, fork } from "node:child_process";
import fs from "node:fs";
import { createConnection } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ServiceMessage = Record<string, unknown>;

const servicePath = fileURLToPath(
    new URL("../view/route/service.js", import.meta.url),
);
const insertOperation = {
    type: "insert",
    position: 0,
    content: [{ type: "text", text: "must-not-write" }],
};

describe("markdown view service binding isolation", () => {
    let viewProcess: ChildProcess | undefined;
    let root: string | undefined;

    afterEach(() => {
        viewProcess?.kill();
        viewProcess = undefined;
        if (root) {
            fs.rmSync(root, { recursive: true, force: true });
            root = undefined;
        }
    });

    async function start(files: Record<string, string>): Promise<number> {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        for (const [relativePath, content] of Object.entries(files)) {
            const filePath = path.join(root, relativePath);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, content, "utf-8");
        }
        viewProcess = fork(servicePath, ["0"], {
            env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        return ready.port as number;
    }

    async function bind(
        relativePath: string,
        requestId: string,
    ): Promise<ServiceMessage> {
        viewProcess!.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath,
        });
        return sendAndWait(
            viewProcess!,
            { type: "getDocumentContent", requestId },
            (message) =>
                message.type === "documentContent" &&
                message.requestId === requestId,
        );
    }

    test("rejects stale token, root, path, and revision writes", async () => {
        await start({ "safe.md": "seed" });
        const bound = await bind("safe.md", "initial-read");
        expect(typeof bound.bindingToken).toBe("string");
        expect(typeof bound.revision).toBe("string");

        const cases: Array<{
            name: string;
            expectation: Record<string, string>;
            flag: string;
        }> = [
            {
                name: "token",
                expectation: { expectedBindingToken: "stale-token" },
                flag: "identityMismatch",
            },
            {
                name: "root",
                expectation: {
                    expectedRoot: path.join(root!, "different-root"),
                },
                flag: "identityMismatch",
            },
            {
                name: "path",
                expectation: { expectedRelativePath: "other.md" },
                flag: "identityMismatch",
            },
            {
                name: "revision",
                expectation: {
                    expectedBindingToken: bound.bindingToken as string,
                    expectedRevision: "stale-revision",
                },
                flag: "revisionMismatch",
            },
        ];

        for (const testCase of cases) {
            const requestId = `reject-${testCase.name}`;
            const response = await sendAndWait(
                viewProcess!,
                {
                    type: "applyLLMOperations",
                    requestId,
                    operations: [insertOperation],
                    ...testCase.expectation,
                },
                (message) =>
                    message.type === "operationsApplied" &&
                    message.requestId === requestId,
            );
            expect(response.success).toBe(false);
            expect(response[testCase.flag]).toBe(true);
        }
        expect(fs.readFileSync(path.join(root!, "safe.md"), "utf-8")).toBe(
            "seed",
        );
    });

    test("preserves the token when rebinding the same relative file", async () => {
        await start({ "same.md": "seed" });
        const updates: string[] = [];
        viewProcess!.on("message", (message: unknown) => {
            if (
                isServiceMessage(message) &&
                message.type === "bindingUpdated" &&
                typeof message.bindingToken === "string"
            ) {
                updates.push(message.bindingToken);
            }
        });

        const first = await bind("same.md", "same-1");
        const second = await bind("same.md", "same-2");
        await waitUntil(() => updates.length >= 2);

        expect(second.bindingToken).toBe(first.bindingToken);
        expect(updates).toEqual([
            first.bindingToken as string,
            first.bindingToken as string,
        ]);
    });

    test("keeps nested same-basename documents in distinct rooms", async () => {
        const port = await start({
            "a/note.md": "seed-a",
            "b/note.md": "seed-b",
        });
        const switchDocument = async (documentPath: string) => {
            const response = await fetch(
                `http://127.0.0.1:${port}/api/switch-document`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ documentPath }),
                },
            );
            expect(response.ok).toBe(true);
            return (await response.json()) as ServiceMessage;
        };

        const first = await switchDocument("a/note");
        const second = await switchDocument("b/note.md");
        expect(first.boundRelativePath).toBe("a/note.md");
        expect(second.boundRelativePath).toBe("b/note.md");
        expect(first.documentId).toBe(first.bindingToken);
        expect(second.documentId).toBe(second.bindingToken);
        expect(second.documentId).not.toBe(first.documentId);

        const rejected = await sendAndWait(
            viewProcess!,
            {
                type: "applyLLMOperations",
                requestId: "stale-sibling",
                operations: [insertOperation],
                expectedBindingToken: first.bindingToken,
                expectedRevision: second.revision,
            },
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "stale-sibling",
        );
        expect(rejected).toMatchObject({
            success: false,
            identityMismatch: true,
        });
        expect(fs.readFileSync(path.join(root!, "a", "note.md"), "utf-8")).toBe(
            "seed-a",
        );
        expect(fs.readFileSync(path.join(root!, "b", "note.md"), "utf-8")).toBe(
            "seed-b",
        );
    });

    test("correlates concurrent reads by requestId", async () => {
        await start({ "concurrent.md": "hello" });
        await bind("concurrent.md", "bind-concurrent");

        const readA = sendAndWait(
            viewProcess!,
            { type: "getDocumentContent", requestId: "read-a" },
            (message) => message.requestId === "read-a",
        );
        const readB = sendAndWait(
            viewProcess!,
            { type: "getDocumentContent", requestId: "read-b" },
            (message) => message.requestId === "read-b",
        );
        const [a, b] = await Promise.all([readA, readB]);
        expect(a.content).toBe("hello");
        expect(b.content).toBe("hello");
        expect(a.revision).toBe(b.revision);
    });

    test("emits bootstrap, binding-change, and snapshot SSE events", async () => {
        const port = await start({
            "first.md": "first",
            "nested/second.md": "second",
        });
        const first = await bind("first.md", "bind-first");
        const controller = new AbortController();
        const events = await openSseEvents(
            `http://127.0.0.1:${port}/events`,
            controller.signal,
        );
        try {
            const bootstrap = await waitForEvent(events, "bindingBootstrap");
            expect(bootstrap).toMatchObject({
                bindingToken: first.bindingToken,
                documentId: first.bindingToken,
                boundRelativePath: "first.md",
            });

            const switchedResponse = await fetch(
                `http://127.0.0.1:${port}/api/switch-document`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        documentPath: "nested/second.md",
                    }),
                },
            );
            const switched = (await switchedResponse.json()) as ServiceMessage;
            expect(switchedResponse.ok).toBe(true);
            const changed = await waitForEvent(events, "documentChanged");
            expect(changed).toMatchObject({
                bindingToken: switched.bindingToken,
                boundRelativePath: "nested/second.md",
            });

            const apply = sendAndWait(
                viewProcess!,
                {
                    type: "applyLLMOperations",
                    requestId: "snapshot-apply",
                    operations: [
                        {
                            type: "insert",
                            position: 0,
                            content: [{ type: "text", text: "updated-" }],
                        },
                    ],
                    expectedBindingToken: switched.bindingToken,
                    expectedRevision: switched.revision,
                },
                (message) => message.requestId === "snapshot-apply",
            );
            const markdownRequest = await waitForEvent(
                events,
                "requestMarkdown",
            );
            const browserResponse = await fetch(
                `http://127.0.0.1:${port}/api/markdown-response`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        requestId: markdownRequest.requestId,
                        markdown: "second",
                        positionInfo: { position: 0 },
                        bindingToken: switched.bindingToken,
                    }),
                },
            );
            expect(browserResponse.ok).toBe(true);
            expect(await apply).toMatchObject({ success: true });
            expect(
                await waitForEvent(events, "documentSnapshot"),
            ).toMatchObject({
                bindingToken: switched.bindingToken,
                markdown: "updated-second",
            });
        } finally {
            controller.abort();
        }
    });

    test("evicts idle rooms after binding rotation", async () => {
        const port = await start({ "a.md": "A", "b.md": "B" });
        await bind("a.md", "room-a");
        const before = (await (
            await fetch(`http://127.0.0.1:${port}/collaboration/info`)
        ).json()) as ServiceMessage;
        await bind("b.md", "room-b");
        const after = (await (
            await fetch(`http://127.0.0.1:${port}/collaboration/info`)
        ).json()) as ServiceMessage;
        expect([before.documents, after.documents]).toEqual([1, 1]);
    });

    test("listens only on the IPv4 loopback interface", async () => {
        const port = await start({});
        const info = (await (
            await fetch(`http://127.0.0.1:${port}/collaboration/info`)
        ).json()) as ServiceMessage;
        expect(info.websocketServerUrl).toBe(`ws://127.0.0.1:${port}`);

        const externalAddress = Object.values(os.networkInterfaces())
            .flat()
            .find(
                (entry) =>
                    entry !== undefined &&
                    !entry.internal &&
                    entry.family === "IPv4",
            )?.address;
        if (externalAddress) {
            await expect(canConnect(externalAddress, port)).resolves.toBe(
                false,
            );
        }
    });
});

function isServiceMessage(value: unknown): value is ServiceMessage {
    return typeof value === "object" && value !== null;
}

function waitForMessage(
    child: ChildProcess,
    predicate: (message: ServiceMessage) => boolean,
): Promise<ServiceMessage> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for view service response"));
        }, 10_000);
        const onMessage = (value: unknown) => {
            if (isServiceMessage(value) && predicate(value)) {
                cleanup();
                resolve(value);
            }
        };
        const onExit = (code: number | null) => {
            cleanup();
            reject(new Error(`View service exited with code ${code}`));
        };
        const cleanup = () => {
            clearTimeout(timeout);
            child.off("message", onMessage);
            child.off("exit", onExit);
        };
        child.on("message", onMessage);
        child.on("exit", onExit);
    });
}

function sendAndWait(
    child: ChildProcess,
    message: ServiceMessage,
    predicate: (response: ServiceMessage) => boolean,
): Promise<ServiceMessage> {
    const response = waitForMessage(child, predicate);
    child.send(message);
    return response;
}

async function openSseEvents(
    url: string,
    signal: AbortSignal,
): Promise<ServiceMessage[]> {
    const response = await fetch(url, { signal });
    if (!response.body) {
        throw new Error("SSE response body missing");
    }
    const events: ServiceMessage[] = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
        let buffered = "";
        while (!signal.aborted) {
            const { value, done } = await reader.read();
            if (done) {
                return;
            }
            buffered += decoder.decode(value, { stream: true });
            const chunks = buffered.split(/\r?\n\r?\n/);
            buffered = chunks.pop() ?? "";
            for (const chunk of chunks) {
                const data = chunk
                    .split(/\r?\n/)
                    .find((line) => line.startsWith("data: "));
                if (data) {
                    const event: unknown = JSON.parse(data.slice(6));
                    if (isServiceMessage(event)) {
                        events.push(event);
                    }
                }
            }
        }
    })().catch((error: unknown) => {
        if (!signal.aborted) {
            throw error;
        }
    });
    return events;
}

async function waitForEvent(
    events: ServiceMessage[],
    type: string,
): Promise<ServiceMessage> {
    let found: ServiceMessage | undefined;
    await waitUntil(() => {
        found = events.find((event) => event.type === type);
        return found !== undefined;
    });
    return found!;
}

async function waitUntil(
    predicate: () => boolean,
    timeoutMs = 5000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (predicate()) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error("Timed out waiting for condition");
}

function canConnect(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = createConnection({ host, port });
        const finish = (connected: boolean) => {
            socket.destroy();
            resolve(connected);
        };
        socket.setTimeout(500, () => finish(false));
        socket.once("connect", () => finish(true));
        socket.once("error", () => finish(false));
    });
}
