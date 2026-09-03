// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const servicePath = fileURLToPath(
    new URL("../view/route/service.js", import.meta.url),
);

describe("markdown view service", () => {
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

    test("applies and persists operations without an SSE client", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "headless.md");
        fs.writeFileSync(filePath, "", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "headless.md",
        });
        viewProcess.send({
            type: "applyLLMOperations",
            requestId: "apply-headless-1",
            operations: [
                {
                    type: "insert",
                    position: 0,
                    content: [
                        {
                            type: "text",
                            text: "# Headless\n\nPersisted by the view service.",
                        },
                    ],
                },
            ],
        });

        const response = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "apply-headless-1",
        );
        expect(response).toMatchObject({
            success: true,
            operationCount: 1,
            method: "server-applied",
            clientsNotified: 0,
        });
        expect(fs.readFileSync(filePath, "utf-8")).toBe(
            "# Headless\n\nPersisted by the view service.",
        );
    });

    test("does not apply streaming operations twice", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "streamed.md");
        fs.writeFileSync(filePath, "already streamed", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "streamed.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "capture-streamed",
        });
        const bound = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "capture-streamed",
        );

        viewProcess.send({
            type: "applyLLMOperations",
            requestId: "apply-streamed",
            operations: [
                {
                    type: "insert",
                    position: 0,
                    content: [{ type: "text", text: "duplicate " }],
                },
            ],
            expectedRevision: "base-before-streaming",
            expectedUpdatedRevision: bound.revision,
        });
        const applied = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "apply-streamed",
        );

        expect(applied.success).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("already streamed");
    });

    test("reroots via setFile workspaceRoot and persists under the new root", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const workspace = fs.mkdtempSync(
            path.join(os.tmpdir(), "markdown-view-workspace-"),
        );
        try {
            const initialFile = path.join(root, "seed.md");
            fs.writeFileSync(initialFile, "", "utf-8");
            const nestedDirectory = path.join(workspace, "nested");
            fs.mkdirSync(nestedDirectory);
            const target = path.join(nestedDirectory, "note.md");
            fs.writeFileSync(target, "", "utf-8");

            viewProcess = fork(servicePath, ["0"], {
                env: {
                    ...process.env,
                    TYPEAGENT_MARKDOWN_ROOT: root,
                },
                stdio: ["ignore", "ignore", "ignore", "ipc"],
            });

            await waitForMessage(
                viewProcess,
                (message) => message.type === "Success",
            );
            viewProcess.send({
                type: "setFile",
                workspaceRoot: nestedDirectory,
                relativePath: "note.md",
            });
            viewProcess.send({
                type: "applyLLMOperations",
                requestId: "apply-reroot-1",
                operations: [
                    {
                        type: "insert",
                        position: 0,
                        content: [
                            {
                                type: "text",
                                text: "# Rerooted",
                            },
                        ],
                    },
                ],
            });

            const response = await waitForMessage(
                viewProcess,
                (message) =>
                    message.type === "operationsApplied" &&
                    message.requestId === "apply-reroot-1",
            );
            expect(response.success).toBe(true);
            expect(fs.readFileSync(target, "utf-8")).toBe("# Rerooted");
            // The original root was left untouched.
            expect(fs.readFileSync(initialFile, "utf-8")).toBe("");
        } finally {
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    test("ignores setFile with an invalid workspaceRoot", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "keep.md");
        fs.writeFileSync(filePath, "", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        // First, bind a file under the initial root.
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "keep.md",
        });
        // A subsequent setFile whose workspaceRoot is not an absolute
        // existing directory must be ignored end-to-end (root does not
        // switch, and the previously bound file remains the target).
        viewProcess.send({
            type: "setFile",
            workspaceRoot: "not-absolute",
            relativePath: "ignored.md",
        });
        viewProcess.send({
            type: "applyLLMOperations",
            requestId: "apply-still-original",
            operations: [
                {
                    type: "insert",
                    position: 0,
                    content: [
                        {
                            type: "text",
                            text: "still original",
                        },
                    ],
                },
            ],
        });
        const response = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "apply-still-original",
        );
        expect(response.success).toBe(true);
        // Root was NOT switched — the write landed on the file we set
        // before the invalid setFile message.
        expect(fs.readFileSync(filePath, "utf-8")).toBe("still original");
        expect(fs.existsSync(path.join(root, "ignored.md"))).toBe(false);
    });

    test("rejects a headless update after the document root is replaced by a junction", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const workspace = fs.mkdtempSync(
            path.join(os.tmpdir(), "markdown-view-workspace-"),
        );
        const documentRoot = path.join(workspace, "notes");
        const movedDocumentRoot = path.join(workspace, "moved-notes");
        const outsideRoot = path.join(workspace, "outside");
        fs.mkdirSync(documentRoot);
        fs.mkdirSync(outsideRoot);
        fs.writeFileSync(path.join(documentRoot, "plan.md"), "inside", "utf-8");
        const outsideFile = path.join(outsideRoot, "plan.md");
        fs.writeFileSync(outsideFile, "outside", "utf-8");

        try {
            viewProcess = fork(servicePath, ["0"], {
                env: {
                    ...process.env,
                    TYPEAGENT_MARKDOWN_ROOT: root,
                },
                stdio: ["ignore", "ignore", "ignore", "ipc"],
            });
            await waitForMessage(
                viewProcess,
                (message) => message.type === "Success",
            );
            viewProcess.send({
                type: "setFile",
                workspaceRoot: documentRoot,
                relativePath: "plan.md",
            });
            viewProcess.send({
                type: "getDocumentContent",
                requestId: "set-file-complete",
            });
            await waitForMessage(
                viewProcess,
                (message) =>
                    message.type === "documentContent" &&
                    message.requestId === "set-file-complete",
            );

            fs.renameSync(documentRoot, movedDocumentRoot);
            fs.symlinkSync(outsideRoot, documentRoot, "junction");
            viewProcess.send({
                type: "applyLLMOperations",
                requestId: "apply-junction",
                operations: [
                    {
                        type: "insert",
                        position: 0,
                        content: [{ type: "text", text: "escaped" }],
                    },
                ],
            });

            const response = await waitForMessage(
                viewProcess,
                (message) =>
                    message.type === "operationsApplied" &&
                    message.requestId === "apply-junction",
            );
            expect(response.success).toBe(false);
            expect(response.error).toMatch(/root is no longer accessible/);
            expect(fs.readFileSync(outsideFile, "utf-8")).toBe("outside");
        } finally {
            if (fs.existsSync(documentRoot)) {
                fs.unlinkSync(documentRoot);
            }
            fs.rmSync(workspace, { recursive: true, force: true });
        }
    });

    test("persists browser autosave content when bound via setFile", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "browser.md");
        fs.writeFileSync(filePath, "", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "browser.md",
        });

        // Capture the current bindingToken the way the browser would -
        // via a getDocumentContent roundtrip on the IPC channel. The
        // /autosave endpoint now requires the trusted token.
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "capture-token-autosave-1",
        });
        const bound = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "capture-token-autosave-1",
        );
        const bindingToken = bound.bindingToken;
        expect(typeof bindingToken).toBe("string");

        const response = await fetch(
            `http://127.0.0.1:${ready.port}/autosave`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: "browser",
                    bindingToken,
                    expectedRevision: bound.revision,
                    content: "# Browser\n\nPersisted by autosave.",
                }),
            },
        );

        expect(response.ok).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8")).toBe(
            "# Browser\n\nPersisted by autosave.",
        );
    });

    test("rejects browser autosave when bindingToken is missing", async () => {
        // Autosave without a token is fail-closed: the browser must have
        // adopted the bootstrap identity before it is allowed to write.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "browser.md");
        fs.writeFileSync(filePath, "seed", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "browser.md",
        });
        // Wait until bound so we know the reject reason is the missing
        // token, not the missing binding.
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "await-bind-missing-token",
        });
        await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "await-bind-missing-token",
        );

        const response = await fetch(
            `http://127.0.0.1:${ready.port}/autosave`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: "browser",
                    content: "should not persist",
                }),
            },
        );

        expect(response.status).toBe(409);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("seed");
    });

    test("rejects browser autosave when bindingToken is stale", async () => {
        // After a rebind, the token rotates. Autosave callers pinned to
        // the pre-rebind token must be rejected so an editor
        // mid-navigation cannot flush its previous content onto the
        // newly-bound file.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "browser.md");
        fs.writeFileSync(filePath, "seed", "utf-8");
        const nextFilePath = path.join(root, "next.md");
        fs.writeFileSync(nextFilePath, "next", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "browser.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "await-bind-stale-1",
        });
        const first = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "await-bind-stale-1",
        );
        const staleToken = first.bindingToken;
        expect(typeof staleToken).toBe("string");

        // Rebind to another file to rotate the token.
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "next.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "await-bind-stale-2",
        });
        const second = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "await-bind-stale-2",
        );
        expect(second.bindingToken).not.toBe(staleToken);

        const response = await fetch(
            `http://127.0.0.1:${ready.port}/autosave`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: "browser",
                    bindingToken: staleToken,
                    content: "stale content",
                }),
            },
        );

        expect(response.status).toBe(409);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("seed");
        expect(fs.readFileSync(nextFilePath, "utf-8")).toBe("next");
    });

    test("rejects browser autosave when no file is bound", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );

        const response = await fetch(
            `http://127.0.0.1:${ready.port}/autosave`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: "default",
                    content: "should not be persisted",
                }),
            },
        );

        expect(response.status).toBe(409);
        expect(fs.readdirSync(root)).toEqual([]);
    });

    test("autosave binds trust boundary: default documentId still writes to bound file", async () => {
        // Regression for Round 1 Blocker 1: browser must never be able to
        // choose the target path. Even when the client sends a wrong or
        // default documentId, autosave must land in the trusted bound file
        // (notes.md) and never write to default.md.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const boundFile = path.join(root, "notes.md");
        fs.writeFileSync(boundFile, "", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "notes.md",
        });
        // Capture the trusted bindingToken; only the token is trusted for
        // path selection, the documentId is intentionally left as
        // "default" so we prove it does NOT influence the target path.
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "capture-token-trust",
        });
        const boundContent = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "capture-token-trust",
        );
        const bindingToken = boundContent.bindingToken;
        expect(typeof bindingToken).toBe("string");

        const response = await fetch(
            `http://127.0.0.1:${ready.port}/autosave`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: "default",
                    bindingToken,
                    expectedRevision: boundContent.revision,
                    content: "# Notes\n\ncontent",
                }),
            },
        );

        expect(response.ok).toBe(true);
        const body = await response.json();
        expect(body).toMatchObject({ roomMismatch: true });
        expect(fs.readFileSync(boundFile, "utf-8")).toBe("# Notes\n\ncontent");
        expect(fs.existsSync(path.join(root, "default.md"))).toBe(false);
    });

    test("applyLLMOperations rejects on expectedBindingToken mismatch", async () => {
        // Regression for Round 1 Blocker 2 (rebased on token identity):
        // agent's read/apply must not clobber a file the view has been
        // rebound to since the read - and a stale token still fails even
        // when the view is rebound to the same basename/relative path.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "bound.md");
        fs.writeFileSync(filePath, "existing", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "bound.md",
        });
        viewProcess.send({
            type: "applyLLMOperations",
            requestId: "apply-stale",
            operations: [
                {
                    type: "insert",
                    position: 0,
                    content: [{ type: "text", text: "should-not-write" }],
                },
            ],
            expectedBindingToken: "stale-token",
        });

        const response = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "apply-stale",
        );
        expect(response.success).toBe(false);
        expect(response.identityMismatch).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("existing");
    });

    test("rebinding to the same relative path preserves the binding token", async () => {
        // A rebound view must reject callers pinned to the pre-rebind
        // token even when the new binding uses the same basename or the
        // same relative path.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "same-basename.md");
        fs.writeFileSync(filePath, "seed", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );

        const bindingUpdates: string[] = [];
        viewProcess.on("message", (message: any) => {
            if (
                message?.type === "bindingUpdated" &&
                typeof message.bindingToken === "string"
            ) {
                bindingUpdates.push(message.bindingToken);
            }
        });

        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "same-basename.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "capture-token-1",
        });
        const first = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "capture-token-1",
        );
        const firstToken = first.bindingToken;
        expect(typeof firstToken).toBe("string");

        // Rebinding the current file is an acknowledgement, not a new identity.
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "same-basename.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "capture-token-2",
        });
        const second = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "capture-token-2",
        );
        expect(second.bindingToken).toBe(firstToken);
        expect(
            bindingUpdates.filter((token) => token === firstToken),
        ).toHaveLength(2);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("seed");
    });

    test("applyLLMOperations rejects on expectedRevision mismatch", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "revised.md");
        fs.writeFileSync(filePath, "original", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "revised.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "read-revision",
        });
        const read = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "read-revision",
        );

        // Send an apply with a bogus expected revision - it must be rejected.
        viewProcess.send({
            type: "applyLLMOperations",
            requestId: "apply-bad-rev",
            operations: [
                {
                    type: "insert",
                    position: 0,
                    content: [{ type: "text", text: "clobber" }],
                },
            ],
            expectedBindingToken: read.bindingToken,
            expectedRevision: "not-a-real-revision",
        });
        const rejected = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "apply-bad-rev",
        );
        expect(rejected.success).toBe(false);
        expect(rejected.revisionMismatch).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("original");
    });

    test("concurrent getDocumentContent requests are correlated by requestId", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "concurrent.md");
        fs.writeFileSync(filePath, "hello", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "concurrent.md",
        });

        viewProcess.send({ type: "getDocumentContent", requestId: "req-a" });
        viewProcess.send({ type: "getDocumentContent", requestId: "req-b" });

        const first = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "req-a",
        );
        const second = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "req-b",
        );
        expect(first.requestId).toBe("req-a");
        expect(second.requestId).toBe("req-b");
        expect(typeof first.revision).toBe("string");
        expect(first.revision).toBe(second.revision);
    });

    test("getDocumentContent reports bound file and root for recovery", async () => {
        // Regression for Round 1 Blocker 3: after restart the agent may not
        // know its bound path; the view must report boundFilePath/boundRoot
        // so the agent can safely adopt them.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "restart.md");
        fs.writeFileSync(filePath, "hello", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "restart.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "read-restart",
        });

        const response = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "read-restart",
        );
        // boundDocumentId is now the binding-scoped opaque room ID
        // (equal to the freshly-rotated bindingToken), so `a/note.md`
        // and `b/note.md` cannot collide on shared basename `note`.
        expect(typeof response.bindingToken).toBe("string");
        expect(response.boundDocumentId).toBe(response.bindingToken);
        expect(response.boundFilePath).toBe(filePath);
        expect(fs.realpathSync(response.boundRoot)).toBe(fs.realpathSync(root));
        expect(response.boundRelativePath).toBe("restart.md");
        expect(typeof response.revision).toBe("string");
        expect(response.identityMismatch).toBeFalsy();
    });

    test("preserves nested user-relative paths through setFile and reports them for recovery", async () => {
        // Regression for the "preserve nested user-relative paths"
        // requirement: setFile must accept "sub/dir/file.md" and the
        // recovery response must report the same normalized POSIX path
        // rather than reducing it to a basename.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const nested = path.join(root, "docs", "team");
        fs.mkdirSync(nested, { recursive: true });
        const filePath = path.join(nested, "roadmap.md");
        fs.writeFileSync(filePath, "hi", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "docs/team/roadmap.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "read-nested",
        });

        const response = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "read-nested",
        );
        expect(response.boundRelativePath).toBe("docs/team/roadmap.md");
        expect(fs.realpathSync(response.boundFilePath)).toBe(
            fs.realpathSync(filePath),
        );
    });

    test("applyLLMOperations rejects on expectedRelativePath mismatch even when token is absent", async () => {
        // Startup window: the agent may issue an apply before it has
        // observed a bindingToken (e.g. the setFile ack is still in
        // flight). The expected root+relativePath fields must then be
        // enough on their own to make the view reject an apply pinned
        // to the wrong identity.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const boundFile = path.join(root, "correct.md");
        const otherFile = path.join(root, "other.md");
        fs.writeFileSync(boundFile, "existing", "utf-8");
        fs.writeFileSync(otherFile, "existing-other", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "correct.md",
        });
        viewProcess.send({
            type: "applyLLMOperations",
            requestId: "apply-wrong-relative",
            operations: [
                {
                    type: "insert",
                    position: 0,
                    content: [{ type: "text", text: "should-not-write" }],
                },
            ],
            // Omit expectedBindingToken to simulate the pre-bindingUpdated
            // startup window; only send the path expectation.
            expectedRoot: root,
            expectedRelativePath: "other.md",
        });

        const response = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "apply-wrong-relative",
        );
        expect(response.success).toBe(false);
        expect(response.identityMismatch).toBe(true);
        expect(fs.readFileSync(boundFile, "utf-8")).toBe("existing");
        expect(fs.readFileSync(otherFile, "utf-8")).toBe("existing-other");
    });

    test("getDocumentContent rejects on expectedRoot mismatch even when token is absent", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.writeFileSync(path.join(root, "bound.md"), "content", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "bound.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "read-wrong-root",
            expectedRoot: path.join(os.tmpdir(), "some-other-root"),
            expectedRelativePath: "bound.md",
        });

        const response = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "read-wrong-root",
        );
        expect(response.identityMismatch).toBe(true);
        expect(response.content).toBe("");
    });

    test("emits bindingBootstrap SSE event to newly-connected clients", async () => {
        // Regression for the browser fail-closed rework: a browser that
        // connects AFTER the agent's setFile must learn the current
        // binding token from the initial SSE event, otherwise its
        // documentSnapshot handler (which now fails closed on a null
        // token) would ignore server-published snapshots and stop
        // reflecting agent edits.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.writeFileSync(path.join(root, "bootstrap.md"), "seed", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "bootstrap.md",
        });
        // Wait for the setFile to be fully processed - use a getDocumentContent
        // roundtrip so we know the view is bound before we connect the SSE.
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "await-bind",
        });
        const boundResponse = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "await-bind",
        );
        const expectedToken = boundResponse.bindingToken;
        expect(typeof expectedToken).toBe("string");

        const controller = new AbortController();
        try {
            const response = await fetch(
                `http://127.0.0.1:${ready.port}/events`,
                { signal: controller.signal },
            );
            expect(response.body).toBeTruthy();
            const reader = response.body!.getReader();
            const decoder = new TextDecoder();
            let buffered = "";
            let bootstrap: any = undefined;
            const readDeadline = Date.now() + 5000;
            while (bootstrap === undefined && Date.now() < readDeadline) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }
                buffered += decoder.decode(value, { stream: true });
                for (const chunk of buffered.split(/\n\n/)) {
                    if (!chunk.startsWith("data: ")) {
                        continue;
                    }
                    const payload = chunk.slice("data: ".length).trim();
                    if (!payload) {
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(payload);
                        if (parsed?.type === "bindingBootstrap") {
                            bootstrap = parsed;
                            break;
                        }
                    } catch {
                        // partial chunk; wait for more
                    }
                }
            }
            expect(bootstrap).toBeDefined();
            expect(bootstrap.bindingToken).toBe(expectedToken);
            // documentId is the binding-scoped opaque room ID (token),
            // not the file basename; basename lives in documentName.
            expect(bootstrap.documentId).toBe(expectedToken);
            expect(bootstrap.documentName).toBe("bootstrap");
            expect(bootstrap.boundRelativePath).toBe("bootstrap.md");
        } finally {
            controller.abort();
        }
    });

    test("in-flight getDocumentContent rejects when setFile rotates during the browser await", async () => {
        // Race test: a browser is connected, so getDocumentContent must
        // await `requestMarkdownFromClient`. During that await the
        // agent (or another browser) issues setFile, rotating the
        // binding. The response must land as identityMismatch, not as
        // `content that matches the wrong identity`.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.writeFileSync(path.join(root, "first.md"), "first-content", "utf-8");
        fs.writeFileSync(
            path.join(root, "second.md"),
            "second-content",
            "utf-8",
        );

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "first.md",
        });

        // Connect a fake `browser` via SSE. The view will send
        // `requestMarkdown` events to it; we intercept the requestId and
        // hold off responding while we rotate the binding.
        const controller = new AbortController();
        const decoder = new TextDecoder();
        let markdownRequestId: string | undefined;
        try {
            const eventsResponse = await fetch(
                `http://127.0.0.1:${ready.port}/events`,
                { signal: controller.signal },
            );
            const reader = eventsResponse.body!.getReader();

            // Kick off a background reader so requestMarkdown / other
            // SSE events are consumed and we notice the requestId.
            const eventBuffer: string[] = [];
            const readerLoop = (async () => {
                let buffered = "";
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        return;
                    }
                    buffered += decoder.decode(value, { stream: true });
                    const parts = buffered.split(/\n\n/);
                    buffered = parts.pop() ?? "";
                    for (const chunk of parts) {
                        if (chunk.startsWith("data: ")) {
                            eventBuffer.push(chunk.slice(6));
                        }
                    }
                }
            })();
            readerLoop.catch(() => {
                /* ignore reader abort */
            });

            // Wait for the SSE connection to register on the view side by
            // reading the bindingBootstrap it emits on connect.
            const bootstrapDeadline = Date.now() + 3000;
            while (Date.now() < bootstrapDeadline) {
                const bootstrap = eventBuffer.find((event) =>
                    event.includes(`"type":"bindingBootstrap"`),
                );
                if (bootstrap) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 20));
            }

            // Send the getDocumentContent request while the client is
            // `connected`. The view will send a requestMarkdown SSE and
            // wait for our /api/markdown-response.
            viewProcess.send({
                type: "getDocumentContent",
                requestId: "race-read",
            });

            const markdownRequestDeadline = Date.now() + 5000;
            while (
                markdownRequestId === undefined &&
                Date.now() < markdownRequestDeadline
            ) {
                for (const raw of eventBuffer) {
                    const match = raw.match(
                        /"type":"requestMarkdown","requestId":"([^"]+)"/,
                    );
                    if (match) {
                        markdownRequestId = match[1];
                        break;
                    }
                }
                if (markdownRequestId === undefined) {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
            }
            expect(typeof markdownRequestId).toBe("string");

            // Rotate the binding while the view is still waiting for our
            // /api/markdown-response.
            viewProcess.send({
                type: "setFile",
                workspaceRoot: root,
                relativePath: "second.md",
            });

            // Wait a tick so the setFile is definitely processed by the
            // view before we let the markdown request complete.
            await new Promise((resolve) => setTimeout(resolve, 50));

            // Now let the browser respond with content matching the OLD
            // binding. The view's recheck must catch the rotation and
            // return identityMismatch instead of pairing the response
            // with the new binding token.
            const postResponse = await fetch(
                `http://127.0.0.1:${ready.port}/api/markdown-response`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        requestId: markdownRequestId,
                        markdown: "first-content-from-browser",
                        positionInfo: { position: 0 },
                    }),
                },
            );
            expect(postResponse.ok).toBe(true);

            const response = await waitForMessage(
                viewProcess,
                (message) =>
                    message.type === "documentContent" &&
                    message.requestId === "race-read",
            );
            expect(response.identityMismatch).toBe(true);
            expect(response.content).toBe("");
        } finally {
            controller.abort();
        }
    });

    test("bindingBootstrap tags the first SSE client as primary and subsequent as secondary", async () => {
        // Primary role must be established by SSE ordering in
        // bindingBootstrap, not by a legacy llmOperations broadcast.
        // The first client to connect is designated primary; a second
        // client sees itself as secondary until the primary drops.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.writeFileSync(path.join(root, "roles.md"), "seed", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "roles.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "roles-await-bind",
        });
        await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "roles-await-bind",
        );

        const controllerA = new AbortController();
        const controllerB = new AbortController();
        try {
            const bootstrapA = await readBindingBootstrap(
                `http://127.0.0.1:${ready.port}/events`,
                controllerA.signal,
            );
            expect(bootstrapA.clientRole).toBe("primary");

            const bootstrapB = await readBindingBootstrap(
                `http://127.0.0.1:${ready.port}/events`,
                controllerB.signal,
            );
            expect(bootstrapB.clientRole).toBe("secondary");
        } finally {
            controllerA.abort();
            controllerB.abort();
        }
    });

    test("promotes a secondary with the revision written by the former primary", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "handoff.md");
        fs.writeFileSync(filePath, "seed", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "handoff.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "handoff-await-bind",
        });
        const bound = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "handoff-await-bind",
        );

        const primaryController = new AbortController();
        const secondaryController = new AbortController();
        try {
            const primaryEvents = await openSseEventStream(
                `http://127.0.0.1:${ready.port}/events`,
                primaryController.signal,
            );
            const primaryBootstrap = await waitForSseEvent(
                primaryEvents,
                "bindingBootstrap",
            );
            expect(primaryBootstrap.clientRole).toBe("primary");

            const secondaryEvents = await openSseEventStream(
                `http://127.0.0.1:${ready.port}/events`,
                secondaryController.signal,
            );
            const secondaryBootstrap = await waitForSseEvent(
                secondaryEvents,
                "bindingBootstrap",
            );
            expect(secondaryBootstrap.clientRole).toBe("secondary");

            const primaryContent = "# Written by the primary\n";
            const primarySave = await fetch(
                `http://127.0.0.1:${ready.port}/autosave`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        content: primaryContent,
                        documentId: bound.bindingToken,
                        bindingToken: bound.bindingToken,
                        expectedRevision: bound.revision,
                    }),
                },
            );
            expect(primarySave.ok).toBe(true);
            const primaryResult = (await primarySave.json()) as {
                revision: string;
            };

            const observedSave = await waitForSseEvent(
                secondaryEvents,
                "autoSave",
            );
            expect(observedSave).toMatchObject({
                bindingToken: bound.bindingToken,
                revision: primaryResult.revision,
            });

            primaryController.abort();
            const promotion = await waitForSseEvent(
                secondaryEvents,
                "primaryElected",
            );
            expect(promotion).toMatchObject({
                bindingToken: bound.bindingToken,
                revision: primaryResult.revision,
            });

            const promotedContent = `${primaryContent}\nContinued by secondary.\n`;
            const promotedSave = await fetch(
                `http://127.0.0.1:${ready.port}/autosave`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        content: promotedContent,
                        documentId: bound.bindingToken,
                        bindingToken: bound.bindingToken,
                        expectedRevision: promotion.revision,
                    }),
                },
            );
            expect(promotedSave.ok).toBe(true);
            expect(fs.readFileSync(filePath, "utf-8")).toBe(promotedContent);
        } finally {
            primaryController.abort();
            secondaryController.abort();
        }
    });

    test("requestMarkdown SSE carries expectedBindingToken; mismatch rejects the pending read", async () => {
        // The async markdown request/response protocol is identity-scoped:
        // the SSE event to the browser must include the expected
        // bindingToken, and the browser MUST echo its current token in
        // the /api/markdown-response body. A mismatched echo (e.g. the
        // browser rebound mid-flight) fails the pending read.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.writeFileSync(path.join(root, "token.md"), "seed", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "token.md",
        });

        const controller = new AbortController();
        try {
            // Connect an SSE client so getDocumentContent goes through
            // requestMarkdownFromClient (which is where the token is
            // threaded), not the file fallback.
            const eventsResponse = await fetch(
                `http://127.0.0.1:${ready.port}/events`,
                { signal: controller.signal },
            );
            const reader = eventsResponse.body!.getReader();
            const decoder = new TextDecoder();
            const eventBuffer: string[] = [];
            const readerLoop = (async () => {
                let buffered = "";
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        return;
                    }
                    buffered += decoder.decode(value, { stream: true });
                    const parts = buffered.split(/\n\n/);
                    buffered = parts.pop() ?? "";
                    for (const chunk of parts) {
                        if (chunk.startsWith("data: ")) {
                            eventBuffer.push(chunk.slice(6));
                        }
                    }
                }
            })();
            readerLoop.catch(() => {
                /* ignore reader abort */
            });

            // Wait for bindingBootstrap so we know the SSE is registered.
            const bootstrapDeadline = Date.now() + 3000;
            while (Date.now() < bootstrapDeadline) {
                const found = eventBuffer.find((event) =>
                    event.includes(`"type":"bindingBootstrap"`),
                );
                if (found) {
                    break;
                }
                await new Promise((resolve) => setTimeout(resolve, 20));
            }

            viewProcess.send({
                type: "getDocumentContent",
                requestId: "token-race",
            });

            // Wait for the requestMarkdown SSE event and capture its
            // expectedBindingToken plus requestId.
            let markdownRequestId: string | undefined;
            let expectedBindingToken: string | undefined;
            const markdownRequestDeadline = Date.now() + 5000;
            while (
                markdownRequestId === undefined &&
                Date.now() < markdownRequestDeadline
            ) {
                for (const raw of eventBuffer) {
                    if (!raw.includes(`"type":"requestMarkdown"`)) {
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(raw);
                        if (parsed?.type === "requestMarkdown") {
                            markdownRequestId = parsed.requestId;
                            expectedBindingToken = parsed.expectedBindingToken;
                            break;
                        }
                    } catch {
                        // partial chunk; wait for more
                    }
                }
                if (markdownRequestId === undefined) {
                    await new Promise((resolve) => setTimeout(resolve, 20));
                }
            }
            expect(typeof markdownRequestId).toBe("string");
            expect(typeof expectedBindingToken).toBe("string");

            // Reply with an obviously-wrong token; the pending read must
            // fail with identityMismatch (surfaced via the file fallback
            // being reached in this scenario, followed by the post-read
            // snapshot recheck). The view's fallback here will use the
            // pinned snapshot to read `seed` from token.md; the outer
            // recheck still succeeds because binding did not rotate. So
            // we assert that a mismatched token does NOT return the
            // browser-provided content.
            const postResponse = await fetch(
                `http://127.0.0.1:${ready.port}/api/markdown-response`,
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        requestId: markdownRequestId,
                        markdown: "wrong-token-content",
                        bindingToken: "not-the-real-token",
                        positionInfo: { position: 0 },
                    }),
                },
            );
            expect(postResponse.ok).toBe(true);

            const response = await waitForMessage(
                viewProcess,
                (message) =>
                    message.type === "documentContent" &&
                    message.requestId === "token-race",
            );
            // Mismatched browser echo must surface as identityMismatch
            // (not silently laundered through the Yjs / file fallback):
            // the browser explicitly answered under a different
            // binding, so the read fails closed and returns no content.
            expect(response.identityMismatch).toBe(true);
            expect(response.content).toBe("");
            expect(response.content).not.toBe("wrong-token-content");
        } finally {
            controller.abort();
        }
    });

    test("/api/switch-document accepts a nested documentPath and preserves the full relative path", async () => {
        // Nested paths (docs/team/plan) must round-trip through the API:
        // the response echoes the full relative path (with .md) and the
        // freshly-rotated bindingToken/documentId, and the file lands at
        // the requested nested location under the trusted root.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );

        const response = await fetch(
            `http://127.0.0.1:${ready.port}/api/switch-document`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentPath: "docs/team/plan" }),
            },
        );
        expect(response.ok).toBe(true);
        const body: any = await response.json();
        expect(body.relativePath).toBe("docs/team/plan.md");
        expect(body.boundRelativePath).toBe("docs/team/plan.md");
        expect(typeof body.bindingToken).toBe("string");
        // documentId (Yjs room) is scoped to the binding, not the file
        // basename, so it equals the freshly-rotated bindingToken.
        expect(body.documentId).toBe(body.bindingToken);
        expect(body.documentName).toBe("plan");
        expect(fs.existsSync(path.join(root, "docs", "team", "plan.md"))).toBe(
            true,
        );
    });

    test("same-basename nested paths get distinct room IDs and cannot cross-write", async () => {
        // Rooms are scoped by opaque bindingToken, not by file basename.
        // Two files that share basename `note` (in `a/` and `b/`)
        // must therefore get distinct room IDs, and a stale
        // expectedBindingToken pinned to the previous binding must be
        // rejected as identityMismatch even though the basename matches.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.mkdirSync(path.join(root, "a"));
        fs.mkdirSync(path.join(root, "b"));
        const aFile = path.join(root, "a", "note.md");
        const bFile = path.join(root, "b", "note.md");
        fs.writeFileSync(aFile, "seed-a", "utf-8");
        fs.writeFileSync(bFile, "seed-b", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: {
                ...process.env,
                TYPEAGENT_MARKDOWN_ROOT: root,
            },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );

        // Bind a/note.md and capture its room ID + token.
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "a/note.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "read-a",
        });
        const readA = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "read-a",
        );
        const tokenA = readA.bindingToken;
        const idA = readA.boundDocumentId;
        expect(typeof tokenA).toBe("string");
        expect(idA).toBe(tokenA);
        expect(readA.boundRelativePath).toBe("a/note.md");
        expect(readA.content).toBe("seed-a");

        // Rebind to b/note.md - basename identical, path differs.
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "b/note.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "read-b",
        });
        const readB = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "read-b",
        );
        const tokenB = readB.bindingToken;
        const idB = readB.boundDocumentId;
        expect(typeof tokenB).toBe("string");
        expect(idB).toBe(tokenB);
        expect(readB.boundRelativePath).toBe("b/note.md");
        expect(readB.content).toBe("seed-b");

        // Distinct room IDs / tokens - proving basename does not
        // scope the Yjs room.
        expect(tokenA).not.toBe(tokenB);
        expect(idA).not.toBe(idB);

        // Apply under the new binding writes only to b/note.md.
        viewProcess.send({
            type: "applyLLMOperations",
            requestId: "apply-b",
            operations: [
                {
                    type: "insert",
                    position: 0,
                    content: [{ type: "text", text: "B-write:" }],
                },
            ],
            expectedBindingToken: tokenB,
        });
        const applyB = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "apply-b",
        );
        expect(applyB.success).toBe(true);
        expect(fs.readFileSync(aFile, "utf-8")).toBe("seed-a");
        expect(fs.readFileSync(bFile, "utf-8")).toBe("B-write:seed-b");

        // Apply pinned to the stale tokenA must be rejected as
        // identityMismatch: the view no longer holds the a/ binding
        // even though its basename matches the current one.
        viewProcess.send({
            type: "applyLLMOperations",
            requestId: "apply-stale-a",
            operations: [
                {
                    type: "insert",
                    position: 0,
                    content: [{ type: "text", text: "should-not-write" }],
                },
            ],
            expectedBindingToken: tokenA,
        });
        const rejected = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "operationsApplied" &&
                message.requestId === "apply-stale-a",
        );
        expect(rejected.success).toBe(false);
        expect(rejected.identityMismatch).toBe(true);
        // Neither file was touched by the stale-pinned request.
        expect(fs.readFileSync(aFile, "utf-8")).toBe("seed-a");
        expect(fs.readFileSync(bFile, "utf-8")).toBe("B-write:seed-b");
    });

    test("autosave persists Markdown syntax (headings, bold, code) verbatim", async () => {
        // Regression: browser autosave used to serialize the editor with
        // ProseMirror `.textContent` which drops all Markdown markers,
        // so a document with `# H`, `**bold**`, and ```` ```code``` ````
        // was silently persisted as `H bold code`. The fix routes
        // autosave through the same Milkdown serializer as everything
        // else, and the endpoint just writes whatever the browser sent.
        // We simulate the fixed browser payload directly and assert the
        // on-disk file preserves every Markdown marker.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "styled.md");
        fs.writeFileSync(filePath, "", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (m) => m.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "styled.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "capture-styled",
        });
        const bound = await waitForMessage(
            viewProcess,
            (m) =>
                m.type === "documentContent" &&
                m.requestId === "capture-styled",
        );
        const bindingToken = bound.bindingToken;

        const markdown = [
            "# Heading",
            "",
            "Paragraph with **bold** and *italic* words.",
            "",
            "```ts",
            "const x = 1;",
            "```",
            "",
        ].join("\n");

        const response = await fetch(
            `http://127.0.0.1:${ready.port}/autosave`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: "styled",
                    bindingToken,
                    expectedRevision: bound.revision,
                    content: markdown,
                }),
            },
        );
        expect(response.ok).toBe(true);

        const persisted = fs.readFileSync(filePath, "utf-8");
        expect(persisted).toBe(markdown);
        // Guard against a regression that would strip individual markers.
        expect(persisted).toContain("# Heading");
        expect(persisted).toContain("**bold**");
        expect(persisted).toContain("```ts");
    });

    test("POST /document requires bindingToken and preserves Markdown syntax", async () => {
        // Regression for Fix #5: POST /document (used by the manual
        // save path in the browser) had no trust checks - it accepted
        // any content field and wrote to disk. A browser tab that
        // missed the last rebind could silently overwrite a different
        // file. The fixed handler shares the /autosave validator, so
        // both fail-closed on a missing token and succeed when the
        // caller carries the current one.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        const filePath = path.join(root, "manual.md");
        fs.writeFileSync(filePath, "seed", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });

        const ready = await waitForMessage(
            viewProcess,
            (m) => m.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "manual.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "capture-manual",
        });
        const bound = await waitForMessage(
            viewProcess,
            (m) =>
                m.type === "documentContent" &&
                m.requestId === "capture-manual",
        );
        const bindingToken = bound.bindingToken;

        // No token -> 409 and no write.
        const rejected = await fetch(
            `http://127.0.0.1:${ready.port}/document`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: "# should-not-write\n" }),
            },
        );
        expect(rejected.status).toBe(409);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("seed");

        // Stale token -> 409 and no write.
        const staleRejected = await fetch(
            `http://127.0.0.1:${ready.port}/document`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: "# should-not-write\n",
                    bindingToken: "stale-token-xyz",
                }),
            },
        );
        expect(staleRejected.status).toBe(409);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("seed");

        // A current token with a stale revision is also rejected.
        const staleRevision = await fetch(
            `http://127.0.0.1:${ready.port}/document`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: "# should-not-write\n",
                    bindingToken,
                    expectedRevision: "stale-revision",
                }),
            },
        );
        expect(staleRevision.status).toBe(409);
        await expect(staleRevision.json()).resolves.toMatchObject({
            content: "seed",
            revision: bound.revision,
        });
        expect(fs.readFileSync(filePath, "utf-8")).toBe("seed");

        // Correct identity and revision -> 200 and Markdown persisted verbatim.
        const markdown =
            "# Manual save\n\nPersisted **via** POST /document.\n\n```md\ncode\n```\n";
        const accepted = await fetch(
            `http://127.0.0.1:${ready.port}/document`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    content: markdown,
                    bindingToken,
                    expectedRevision: bound.revision,
                }),
            },
        );
        expect(accepted.ok).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8")).toBe(markdown);
    });

    test("POST /file/load is unavailable and cannot retarget the active binding", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.writeFileSync(path.join(root, "bound.md"), "bound-content", "utf-8");
        fs.writeFileSync(path.join(root, "other.md"), "other-content", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );
        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "bound.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "before-dead-load",
        });
        const before = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "before-dead-load",
        );

        const response = await fetch(
            `http://127.0.0.1:${ready.port}/file/load`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filePath: "other.md" }),
            },
        );
        expect(response.status).toBe(404);

        viewProcess.send({
            type: "getDocumentContent",
            requestId: "after-dead-load",
        });
        const after = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "after-dead-load",
        );
        expect(after).toMatchObject({
            bindingToken: before.bindingToken,
            boundRelativePath: "bound.md",
            content: "bound-content",
        });
    });

    test("/collaboration/info returns the opaque documentId, distinct for same-basename siblings", async () => {
        // Regression for Fix #3: the endpoint used to return only the
        // basename (`note`) as `currentDocument`, and the browser then
        // used that as its Yjs room key. Two files that share a
        // basename in different folders would coalesce onto the same
        // room. The fixed endpoint returns a `documentId` equal to
        // the opaque bindingToken (the actual room key the service
        // uses everywhere else), so nested siblings are isolated.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.mkdirSync(path.join(root, "a"));
        fs.mkdirSync(path.join(root, "b"));
        fs.writeFileSync(path.join(root, "a", "note.md"), "A", "utf-8");
        fs.writeFileSync(path.join(root, "b", "note.md"), "B", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const ready = await waitForMessage(
            viewProcess,
            (m) => m.type === "Success",
        );

        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "a/note.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "read-a-info",
        });
        const readA = await waitForMessage(
            viewProcess,
            (m) =>
                m.type === "documentContent" && m.requestId === "read-a-info",
        );
        const collabA = (await (
            await fetch(`http://127.0.0.1:${ready.port}/collaboration/info`)
        ).json()) as { documentId: string; currentDocument: string };
        expect(collabA.documentId).toBe(readA.bindingToken);
        expect(collabA.currentDocument).toBe("note");

        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "b/note.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "read-b-info",
        });
        const readB = await waitForMessage(
            viewProcess,
            (m) =>
                m.type === "documentContent" && m.requestId === "read-b-info",
        );
        const collabB = (await (
            await fetch(`http://127.0.0.1:${ready.port}/collaboration/info`)
        ).json()) as { documentId: string; currentDocument: string };
        expect(collabB.documentId).toBe(readB.bindingToken);
        expect(collabB.currentDocument).toBe("note");

        // Same basename, different bound files - documentIds MUST
        // differ so the browser opens different Yjs rooms.
        expect(collabA.documentId).not.toBe(collabB.documentId);
    });

    test("nested /api/switch-document opens the intended file with no junk siblings", async () => {
        // Regression for Fix #2 (service side): the switch endpoint
        // must honor the full nested relative path. Combined with the
        // browser-side URL parser fix, this stops `/document/team/2025/plan`
        // from being reduced to `team` on the browser and then landing
        // on a stray `team.md` at the root.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.mkdirSync(path.join(root, "team", "2025"), { recursive: true });
        const targetPath = path.join(root, "team", "2025", "plan.md");
        fs.writeFileSync(targetPath, "planned", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const ready = await waitForMessage(
            viewProcess,
            (m) => m.type === "Success",
        );

        const before = fs.readdirSync(root).sort();
        const switchResp = await fetch(
            `http://127.0.0.1:${ready.port}/api/switch-document`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentPath: "team/2025/plan.md" }),
            },
        );
        expect(switchResp.ok).toBe(true);
        const switchBody = (await switchResp.json()) as {
            boundRelativePath: string;
            content: string;
        };
        expect(switchBody.boundRelativePath).toBe("team/2025/plan.md");
        expect(switchBody.content).toBe("planned");
        expect(fs.existsSync(targetPath)).toBe(true);
        // No stray `team.md` at the root - would appear if the
        // browser had reduced `/document/team/2025/plan` to `team`
        // and the endpoint had treated `team` as a new document.
        expect(fs.existsSync(path.join(root, "team.md"))).toBe(false);
        expect(fs.readdirSync(root).sort()).toEqual(before);

        // And a URL-encoded space in a segment must also decode to a
        // real relative filename, not the literal `my%20notes.md`.
        fs.writeFileSync(path.join(root, "my notes.md"), "notes", "utf-8");
        const spacedResp = await fetch(
            `http://127.0.0.1:${ready.port}/api/switch-document`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ documentPath: "my notes.md" }),
            },
        );
        expect(spacedResp.ok).toBe(true);
        const spacedBody = (await spacedResp.json()) as {
            boundRelativePath: string;
            content: string;
        };
        expect(spacedBody.boundRelativePath).toBe("my notes.md");
        expect(spacedBody.content).toBe("notes");
        // No `my%20notes.md` literal created.
        expect(fs.existsSync(path.join(root, "my%20notes.md"))).toBe(false);
    });

    test("evicts stale Y.Doc / awareness state after binding rotation with no attached clients", async () => {
        // Regression for Fix #6: every rebinding creates a new opaque
        // documentId, so the OLD room's Y.Doc used to linger in the
        // in-memory `docs` map forever. The fixed service evicts the
        // old room when no WebSocket client is attached. We probe the
        // internal maps indirectly by observing the debug output
        // through the /collaboration/info stats: `documents` reports
        // the size of `docs` and must not grow unboundedly after
        // repeated rebindings.
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.writeFileSync(path.join(root, "a.md"), "A", "utf-8");
        fs.writeFileSync(path.join(root, "b.md"), "B", "utf-8");
        fs.writeFileSync(path.join(root, "c.md"), "C", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const ready = await waitForMessage(
            viewProcess,
            (m) => m.type === "Success",
        );

        async function bindAndGetStats(rel: string): Promise<{
            documents: number;
        }> {
            viewProcess!.send({
                type: "setFile",
                workspaceRoot: root!,
                relativePath: rel,
            });
            viewProcess!.send({
                type: "getDocumentContent",
                requestId: `bind-${rel}`,
            });
            await waitForMessage(
                viewProcess!,
                (m) =>
                    m.type === "documentContent" &&
                    m.requestId === `bind-${rel}`,
            );
            const info = (await (
                await fetch(`http://127.0.0.1:${ready.port}/collaboration/info`)
            ).json()) as { documents: number };
            return { documents: info.documents };
        }

        const afterA = await bindAndGetStats("a.md");
        const afterB = await bindAndGetStats("b.md");
        const afterC = await bindAndGetStats("c.md");

        // Without eviction, `documents` would grow monotonically with
        // every rebinding (1 -> 2 -> 3). With eviction of idle rooms
        // it must stay at 1 across all three rebinds because there is
        // no WebSocket client attached to any old room.
        expect(afterA.documents).toBe(1);
        expect(afterB.documents).toBe(1);
        expect(afterC.documents).toBe(1);
    });

    test("evicts a rotated room after its last WebSocket disconnects", async () => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "markdown-view-test-"));
        fs.writeFileSync(path.join(root, "a.md"), "A", "utf-8");
        fs.writeFileSync(path.join(root, "b.md"), "B", "utf-8");

        viewProcess = fork(servicePath, ["0"], {
            env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
            stdio: ["ignore", "ignore", "ignore", "ipc"],
        });
        const ready = await waitForMessage(
            viewProcess,
            (message) => message.type === "Success",
        );

        viewProcess.send({
            type: "setFile",
            workspaceRoot: root,
            relativePath: "a.md",
        });
        viewProcess.send({
            type: "getDocumentContent",
            requestId: "connected-room-a",
        });
        const first = await waitForMessage(
            viewProcess,
            (message) =>
                message.type === "documentContent" &&
                message.requestId === "connected-room-a",
        );

        const socket = new WebSocket(
            `ws://127.0.0.1:${ready.port}/${first.bindingToken}`,
            { origin: `http://127.0.0.1:${ready.port}` },
        );
        await new Promise<void>((resolve, reject) => {
            socket.once("open", resolve);
            socket.once("error", reject);
        });

        try {
            viewProcess.send({
                type: "setFile",
                workspaceRoot: root,
                relativePath: "b.md",
            });
            viewProcess.send({
                type: "getDocumentContent",
                requestId: "connected-room-b",
            });
            await waitForMessage(
                viewProcess,
                (message) =>
                    message.type === "documentContent" &&
                    message.requestId === "connected-room-b",
            );

            const whileConnected = (await (
                await fetch(`http://127.0.0.1:${ready.port}/collaboration/info`)
            ).json()) as { documents: number };
            expect(whileConnected.documents).toBe(2);
        } finally {
            await new Promise<void>((resolve) => {
                socket.once("close", resolve);
                socket.close();
            });
        }

        await waitForDocumentCount(ready.port, 1);
    });
});

async function readBindingBootstrap(
    url: string,
    signal: AbortSignal,
): Promise<any> {
    const response = await fetch(url, { signal });
    if (!response.body) {
        throw new Error("SSE response body missing");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) {
            throw new Error("SSE stream closed before bindingBootstrap");
        }
        buffered += decoder.decode(value, { stream: true });
        const parts = buffered.split(/\n\n/);
        buffered = parts.pop() ?? "";
        for (const chunk of parts) {
            if (!chunk.startsWith("data: ")) {
                continue;
            }
            const payload = chunk.slice("data: ".length).trim();
            if (!payload) {
                continue;
            }
            try {
                const parsed = JSON.parse(payload);
                if (parsed?.type === "bindingBootstrap") {
                    return parsed;
                }
            } catch {
                // partial chunk; keep reading
            }
        }
    }
    throw new Error("Timed out waiting for bindingBootstrap SSE event");
}

async function openSseEventStream(
    url: string,
    signal: AbortSignal,
): Promise<any[]> {
    const response = await fetch(url, { signal });
    if (!response.body) {
        throw new Error("SSE response body missing");
    }

    const events: any[] = [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    void (async () => {
        let buffered = "";
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    return;
                }
                buffered += decoder.decode(value, { stream: true });
                const chunks = buffered.split(/\n\n/);
                buffered = chunks.pop() ?? "";
                for (const chunk of chunks) {
                    if (!chunk.startsWith("data: ")) {
                        continue;
                    }
                    try {
                        events.push(JSON.parse(chunk.slice("data: ".length)));
                    } catch {
                        // Ignore malformed events; the next complete event can
                        // still be consumed from this long-lived stream.
                    }
                }
            }
        } catch (error) {
            if (!signal.aborted) {
                throw error;
            }
        }
    })();
    return events;
}

async function waitForSseEvent(
    events: any[],
    type: string,
    timeoutMs = 5000,
): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const event = events.find((candidate) => candidate?.type === type);
        if (event !== undefined) {
            return event;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for ${type} SSE event`);
}

function waitForMessage(
    child: ChildProcess,
    predicate: (message: any) => boolean,
): Promise<any> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for view service response"));
        }, 10_000);
        const onMessage = (message: any) => {
            if (predicate(message)) {
                cleanup();
                resolve(message);
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

async function waitForDocumentCount(
    port: number,
    expected: number,
): Promise<void> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const info = (await (
            await fetch(`http://127.0.0.1:${port}/collaboration/info`)
        ).json()) as { documents: number };
        if (info.documents === expected) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for ${expected} collaboration document`);
}
