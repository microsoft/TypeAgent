// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    computeContentRevision,
    persistDocumentOperations,
    readBoundDocument,
    type DocumentBinding,
} from "../src/agent/documentUpdatePersistence.js";
import {
    getDocumentContentFromView,
    sendOperationsToView,
} from "../src/agent/markdownActionHandler.js";

describe("markdown update persistence", () => {
    let temporaryDirectory: string;
    let workspace: string;
    let filePath: string;
    let binding: DocumentBinding;

    beforeEach(() => {
        temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-update-"),
        );
        workspace = path.join(temporaryDirectory, "workspace");
        fs.mkdirSync(path.join(workspace, "notes"), { recursive: true });
        workspace = fs.realpathSync(workspace);
        filePath = path.join(workspace, "notes", "plan.md");
        fs.writeFileSync(filePath, "original", "utf-8");
        binding = {
            token: "binding-1",
            root: workspace,
            relativePath: "notes/plan.md",
            filePath,
        };
    });

    afterEach(() => {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    test("persists operations and treats a repeated apply as complete", () => {
        const operation = {
            type: "insert" as const,
            position: 8,
            content: [{ type: "text" as const, text: " updated" }],
        };
        const expected = {
            bindingToken: binding.token,
            root: binding.root,
            relativePath: binding.relativePath,
            revision: computeContentRevision("original"),
            updatedRevision: computeContentRevision("original updated"),
        };

        expect(
            persistDocumentOperations(binding, [operation], expected)
                .alreadyApplied,
        ).toBe(false);
        expect(
            persistDocumentOperations(binding, [operation], expected)
                .alreadyApplied,
        ).toBe(true);
        expect(fs.readFileSync(filePath, "utf-8")).toBe("original updated");
    });

    test("rejects stale revisions and binding identities", () => {
        fs.writeFileSync(filePath, "changed", "utf-8");
        expect(() =>
            persistDocumentOperations(binding, [], {
                bindingToken: binding.token,
                root: binding.root,
                relativePath: binding.relativePath,
                revision: computeContentRevision("original"),
                updatedRevision: undefined,
            }),
        ).toThrow(/revision mismatch/);
        expect(() =>
            persistDocumentOperations(binding, [], {
                bindingToken: "binding-2",
                root: binding.root,
                relativePath: binding.relativePath,
                revision: computeContentRevision("changed"),
                updatedRevision: undefined,
            }),
        ).toThrow(/binding token changed/);
    });

    test("rejects a workspace replaced by a junction", () => {
        const movedWorkspace = path.join(temporaryDirectory, "moved-workspace");
        const outside = path.join(temporaryDirectory, "outside");
        fs.mkdirSync(outside);
        fs.writeFileSync(path.join(outside, "plan.md"), "outside", "utf-8");
        fs.renameSync(workspace, movedWorkspace);
        fs.symlinkSync(outside, workspace, "junction");

        expect(() => readBoundDocument(binding)).toThrow(
            /workspace root changed/,
        );
        expect(fs.readFileSync(path.join(outside, "plan.md"), "utf-8")).toBe(
            "outside",
        );
        fs.unlinkSync(workspace);
    });

    test("correlates concurrent view reads and applies", async () => {
        const view = new EventEmitter() as EventEmitter & {
            send: (message: Record<string, unknown>) => void;
        };
        view.send = (message) => {
            const requestId = message.requestId as string;
            queueMicrotask(() => {
                view.emit("message", {
                    type:
                        message.type === "getDocumentContent"
                            ? "documentContent"
                            : "operationsApplied",
                    requestId: "unrelated",
                    success: false,
                });
                view.emit("message", {
                    type:
                        message.type === "getDocumentContent"
                            ? "documentContent"
                            : "operationsApplied",
                    requestId,
                    content: "original",
                    bindingToken: binding.token,
                    revision: computeContentRevision("original"),
                    success: true,
                });
            });
        };
        const child = view as unknown as ChildProcess;
        const identity = {
            expectedBindingToken: binding.token,
            expectedRoot: binding.root,
            expectedRelativePath: binding.relativePath,
        };

        await expect(
            getDocumentContentFromView(child, identity),
        ).resolves.toMatchObject({ content: "original" });
        await expect(
            sendOperationsToView(child, [], {
                ...identity,
                expectedRevision: computeContentRevision("original"),
                expectedUpdatedRevision: undefined,
            }),
        ).resolves.toMatchObject({ success: true });
    });
});
