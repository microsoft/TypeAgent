// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ChildProcess, fork } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
            filePath: "headless.md",
        });
        viewProcess.send({
            type: "applyLLMOperations",
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
            (message) => message.type === "operationsApplied",
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

    test("persists browser autosave content", async () => {
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
        const response = await fetch(
            `http://127.0.0.1:${ready.port}/autosave`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    documentId: "browser",
                    content: "# Browser\n\nPersisted by autosave.",
                }),
            },
        );

        expect(response.ok).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8")).toBe(
            "# Browser\n\nPersisted by autosave.",
        );
    });
});

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
