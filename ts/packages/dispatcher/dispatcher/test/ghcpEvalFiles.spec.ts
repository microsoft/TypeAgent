// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PermissionRequest } from "@github/copilot-sdk";
import {
    ghcpEvalFileActionAllowed,
    ghcpEvalFileWriteAllowed,
    ghcpEvalNativeFilePermission,
    isGhcpEvalFixtureFile,
    readGhcpEvalFilePolicy,
    type GhcpEvalFilePolicy,
} from "../src/execute/ghcpEvalFiles.js";
import { assertGhcpEvalAction } from "../src/execute/ghcpEvalPolicy.js";

describe("common-file evaluation scope", () => {
    let root: string;
    let policy: GhcpEvalFilePolicy;
    const original = "milk\neggs\nrice\n";
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "ghcp-files-"));
        fs.writeFileSync(path.join(root, "grocery.txt"), original);
        fs.writeFileSync(path.join(root, "other.txt"), "preserve");
        policy = {
            version: 1,
            readFiles: ["grocery.txt", "grocery-backup.txt"],
            writeFiles: ["grocery.txt", "grocery-backup.txt"],
            readsEnabled: true,
            writesEnabled: true,
            allowInventory: false,
            allowCopy: {
                source: "grocery.txt",
                destination: "grocery-backup.txt",
            },
            prerequisites: {
                "grocery.txt": { "grocery-backup.txt": original },
            },
        };
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
    it("requires the exact original backup before overwriting grocery", () => {
        const file = path.join(root, "grocery.txt");
        expect(ghcpEvalFileWriteAllowed(file, root, policy)).toBe(false);
        expect(
            ghcpEvalFileActionAllowed(
                "copyFile",
                {
                    source: file,
                    destination: path.join(root, "grocery-backup.txt"),
                },
                root,
                policy,
            ),
        ).toBe(true);
        fs.writeFileSync(path.join(root, "grocery-backup.txt"), "wrong");
        expect(ghcpEvalFileWriteAllowed(file, root, policy)).toBe(false);
        fs.copyFileSync(file, path.join(root, "grocery-backup.txt"));
        expect(ghcpEvalFileWriteAllowed(file, root, policy)).toBe(true);
        expect(
            ghcpEvalFileActionAllowed(
                "deleteFile",
                { path: file },
                root,
                policy,
            ),
        ).toBe(false);
        expect(
            ghcpEvalFileActionAllowed(
                "copyFile",
                {
                    source: file,
                    destination: path.join(root, "other.txt"),
                },
                root,
                policy,
            ),
        ).toBe(false);
    });
    it("retains managed approval and sandbox boundaries for native editors", () => {
        policy.prerequisites = {};
        const request: Extract<PermissionRequest, { kind: "write" }> = {
            kind: "write",
            fileName: path.join(root, "grocery.txt"),
            intention: "edit fixture",
            diff: "",
            canOfferSessionApproval: false,
        };
        expect(ghcpEvalNativeFilePermission(request, root, policy)).toBe(true);
        for (const denied of [
            { ...request, fileName: path.join(root, "other.txt") },
            { ...request, fileName: path.resolve(root, "..", "grocery.txt") },
            { ...request, managedApprovalRequired: true },
            { ...request, requestSandboxBypass: true },
        ])
            expect(ghcpEvalNativeFilePermission(denied, root, policy)).toBe(
                false,
            );
        policy.writesEnabled = false;
        expect(ghcpEvalNativeFilePermission(request, root, policy)).toBe(false);
        expect(
            ghcpEvalFileActionAllowed(
                "writeFile",
                { path: request.fileName, content: "new" },
                root,
                policy,
            ),
        ).toBe(false);
    });
    it("blocks fixture reads until ambiguous file selection is resolved", () => {
        const file = path.join(root, "grocery.txt");
        policy.readsEnabled = false;
        expect(
            ghcpEvalFileActionAllowed("readFile", { path: file }, root, policy),
        ).toBe(false);
        expect(
            ghcpEvalNativeFilePermission(
                {
                    kind: "read",
                    intention: "read",
                    path: file,
                },
                root,
                policy,
            ),
        ).toBe(false);
        policy.readsEnabled = true;
        expect(
            ghcpEvalFileActionAllowed(
                "readFile",
                { path: "grocery.txt" },
                root,
                policy,
            ),
        ).toBe(false);
        expect(
            ghcpEvalFileActionAllowed("readFile", { path: file }, root, policy),
        ).toBe(true);
    });
    it("rejects hardlinks, nested paths and directory-link escapes", () => {
        fs.linkSync(
            path.join(root, "grocery.txt"),
            path.join(root, "grocery-backup.txt"),
        );
        expect(
            isGhcpEvalFixtureFile(
                path.join(root, "grocery.txt"),
                root,
                policy.writeFiles,
            ),
        ).toBe(false);
        fs.mkdirSync(path.join(root, "child"));
        fs.writeFileSync(path.join(root, "child", "grocery.txt"), original);
        expect(
            isGhcpEvalFixtureFile(
                path.join(root, "child", "grocery.txt"),
                root,
                policy.writeFiles,
            ),
        ).toBe(false);
        fs.symlinkSync(
            path.join(root, "child"),
            path.join(root, "alias"),
            "junction",
        );
        expect(
            isGhcpEvalFixtureFile(
                path.join(root, "alias", "grocery.txt"),
                root,
                policy.writeFiles,
            ),
        ).toBe(false);
    });
    it("wires manifest policy into the dispatcher without enabling list mutations", () => {
        const previous = process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY;
        const manifest = path.join(root, "policy.json");
        policy.prerequisites = {};
        fs.writeFileSync(manifest, JSON.stringify(policy));
        try {
            process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY = manifest;
            expect(() =>
                assertGhcpEvalAction(
                    "powershell.powershell-files",
                    "writeFile",
                    {
                        path: path.join(root, "grocery.txt"),
                        content: "new",
                    },
                    root,
                ),
            ).not.toThrow();
            expect(() =>
                assertGhcpEvalAction("list", "clearList", {}, root),
            ).toThrow("policy denied");
            fs.writeFileSync(
                manifest,
                JSON.stringify({ ...policy, writesEnabled: false }),
            );
            expect(() =>
                assertGhcpEvalAction(
                    "powershell.powershell-files",
                    "writeFile",
                    {
                        path: path.join(root, "grocery.txt"),
                        content: "new",
                    },
                    root,
                ),
            ).toThrow("policy denied");
            fs.writeFileSync(
                manifest,
                JSON.stringify({ ...policy, writeFiles: ["../secret"] }),
            );
            expect(() => readGhcpEvalFilePolicy(manifest)).toThrow("Invalid");
        } finally {
            if (previous === undefined)
                delete process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY;
            else process.env.TYPEAGENT_GHCP_EVAL_FILE_POLICY = previous;
        }
    });
});
