// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Suspend the real reader after opening its handle so rebinding is deterministic.
const readGatePreload = `
import fs from "node:fs";
const open = fs.promises.open;
fs.promises.open = async (...args) => {
    const handle = await open(...args);
    process.send?.({ type: "readPaused" });
    await new Promise(resolve => {
        const release = message => {
            if (message.type === "releaseRead") {
                process.off("message", release);
                resolve();
            }
        };
        process.on("message", release);
    });
    return handle;
};
`;

function nextMessage(child: ChildProcess, type: string) {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for ${type}`));
        }, 10_000);
        const receive = (message: Record<string, unknown>) => {
            if (message.type === type) {
                cleanup();
                resolve(message);
            }
        };
        const failed = (error: Error) => {
            cleanup();
            reject(error);
        };
        const exited = () => failed(new Error(`Service exited before ${type}`));
        function cleanup() {
            clearTimeout(timer);
            child.off("message", receive);
            child.off("error", failed);
            child.off("exit", exited);
        }
        child.on("message", receive);
        child.on("error", failed);
        child.on("exit", exited);
    });
}

describe("markdown service document reads", () => {
    let temporaryDirectory: string;
    let root: string;
    let child: ChildProcess;
    let port: number;

    beforeEach(async () => {
        temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-service-"),
        );
        root = fs.realpathSync(temporaryDirectory);
        fs.writeFileSync(path.join(root, "plan.md"), "original");
        fs.writeFileSync(path.join(root, "other.md"), "other");
        child = fork(
            fileURLToPath(new URL("../view/route/service.js", import.meta.url)),
            ["0"],
            {
                env: { ...process.env, TYPEAGENT_MARKDOWN_ROOT: root },
                execArgv: [
                    "--import",
                    `data:text/javascript,${encodeURIComponent(readGatePreload)}`,
                ],
                stdio: ["ignore", "ignore", "inherit", "ipc"],
            },
        );
        const ready = await nextMessage(child, "Success");
        port = ready.port as number;
    });

    afterEach(async () => {
        if (child && child.exitCode === null && child.signalCode === null) {
            await new Promise<void>((resolve) => {
                child.once("exit", () => resolve());
                child.kill();
            });
        }
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    async function bind(relativePath: string, workspaceRoot = root) {
        const bound = nextMessage(child, "bindingUpdated");
        child.send({ type: "setFile", relativePath, workspaceRoot });
        return bound;
    }

    async function load(filePath: string) {
        return fetch(`http://127.0.0.1:${port}/file/load`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ filePath }),
        });
    }

    test("loading a missing nested document has no filesystem side effects", async () => {
        const response = await load("missing/nested/document.md");
        expect(response.status).toBe(403);
        expect(fs.existsSync(path.join(root, "missing"))).toBe(false);
    });

    test("loads only existing files under the current authorized root", async () => {
        const workspace = path.join(root, "workspace");
        fs.mkdirSync(workspace);
        fs.writeFileSync(path.join(workspace, "current.md"), "current");
        await bind("current.md", workspace);

        const response = await load("current.md");
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ content: "current" });
        expect((await load("../plan.md")).status).toBe(403);
        expect((await load(path.join(root, "plan.md"))).status).toBe(403);
        expect((await load(".")).status).toBe(403);

        fs.symlinkSync(root, path.join(workspace, "escape"), "junction");
        expect((await load("escape/plan.md")).status).toBe(403);
    });

    test("returns the durable snapshot after an asynchronous read", async () => {
        await bind("plan.md");
        const paused = nextMessage(child, "readPaused");
        const response = nextMessage(child, "documentContent");
        child.send({ type: "getDocumentContent", requestId: "read-1" });
        await paused;
        child.send({ type: "releaseRead" });
        expect(await response).toMatchObject({
            requestId: "read-1",
            content: "original",
            source: "file",
        });
    });

    test("rejects the previous HTTP load token after rebinding the same document", async () => {
        const loaded = nextMessage(child, "bindingUpdated");
        expect((await load("plan.md")).status).toBe(200);
        const previousBinding = await loaded;
        const currentBinding = await bind("plan.md");
        expect(currentBinding.bindingToken).not.toBe(
            previousBinding.bindingToken,
        );

        const response = nextMessage(child, "documentContent");
        child.send({
            type: "getDocumentContent",
            requestId: "stale-load-token",
            expectedBindingToken: previousBinding.bindingToken,
        });
        expect(await response).toMatchObject({
            requestId: "stale-load-token",
            source: "error",
            content: "",
            identityMismatch: true,
            error: "Document binding token changed",
        });
        expect(fs.readFileSync(path.join(root, "plan.md"), "utf-8")).toBe(
            "original",
        );
    });

    test("reads external disk edits instead of the initialized collaborative snapshot", async () => {
        await bind("plan.md");
        fs.writeFileSync(path.join(root, "plan.md"), "externally updated 😀");
        const paused = nextMessage(child, "readPaused");
        const response = nextMessage(child, "documentContent");
        child.send({ type: "getDocumentContent", requestId: "external-read" });
        await paused;
        child.send({ type: "releaseRead" });
        expect(await response).toMatchObject({
            requestId: "external-read",
            content: "externally updated 😀",
            source: "file",
        });
    });

    test.each(["other.md", "plan.md"])(
        "rejects a read when the service rebinds to %s during suspension",
        async (nextPath) => {
            const binding = await bind("plan.md");
            const paused = nextMessage(child, "readPaused");
            const response = nextMessage(child, "documentContent");
            child.send({
                type: "getDocumentContent",
                requestId: "read-1",
                expectedBindingToken: binding.bindingToken,
            });
            await paused;
            await bind(nextPath);
            child.send({ type: "releaseRead" });
            expect(await response).toMatchObject({
                requestId: "read-1",
                source: "error",
                content: "",
                identityMismatch: true,
                error: "Document binding changed while reading",
            });
        },
    );
});
