// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
    fetchWorkspaceUrl,
    globWorkspace,
    grepWorkspace,
    readWorkspaceFile,
} from "../src/mcp/workspaceServer.js";

describe("workspace MCP primitives", () => {
    let workspace: string;
    let outside: string;
    let previousRoots: string | undefined;

    beforeEach(() => {
        workspace = mkdtempSync(path.join(tmpdir(), "typeagent-workspace-"));
        outside = mkdtempSync(path.join(tmpdir(), "typeagent-outside-"));
        previousRoots = process.env.TYPEAGENT_WORKSPACE_ROOTS;
        process.env.TYPEAGENT_WORKSPACE_ROOTS = workspace;

        mkdirSync(path.join(workspace, "src"), { recursive: true });
        mkdirSync(path.join(workspace, "node_modules", "ignored"), {
            recursive: true,
        });
        writeFileSync(
            path.join(workspace, "src", "alpha.ts"),
            "first\nconst answer = 42;\nlast\n",
        );
        writeFileSync(
            path.join(workspace, "src", "beta.txt"),
            "answer appears here\n",
        );
        writeFileSync(
            path.join(workspace, "node_modules", "ignored", "hidden.ts"),
            "const answer = 0;\n",
        );
        writeFileSync(path.join(outside, "secret.txt"), "secret\n");
    });

    afterEach(() => {
        if (previousRoots === undefined) {
            delete process.env.TYPEAGENT_WORKSPACE_ROOTS;
        } else {
            process.env.TYPEAGENT_WORKSPACE_ROOTS = previousRoots;
        }
        rmSync(workspace, { recursive: true, force: true });
        rmSync(outside, { recursive: true, force: true });
    });

    it("reads bounded line ranges under the workspace root", async () => {
        await expect(
            readWorkspaceFile({
                path: "src/alpha.ts",
                startLine: 2,
                endLine: 2,
            }),
        ).resolves.toMatchObject({
            path: "src/alpha.ts",
            startLine: 2,
            endLine: 2,
            text: "const answer = 42;",
        });
    });

    it("rejects paths outside approved workspace roots", async () => {
        await expect(
            readWorkspaceFile({ path: path.join(outside, "secret.txt") }),
        ).rejects.toThrow("approved workspace root");
    });

    it("finds files deterministically and skips dependency directories", async () => {
        await expect(
            globWorkspace({ pattern: "**/*.{ts,txt}" }),
        ).resolves.toEqual({
            matches: ["src/alpha.ts", "src/beta.txt"],
            truncated: false,
        });
    });

    it("searches text with include and context bounds", async () => {
        const result = await grepWorkspace({
            pattern: "answer",
            include: ["**/*.ts"],
            contextLines: 1,
        });

        expect(result).toEqual({
            matches: [
                {
                    path: "src/alpha.ts",
                    line: 2,
                    text: "const answer = 42;",
                    before: ["first"],
                    after: ["last"],
                },
            ],
            truncated: false,
        });
    });

    it("blocks private-network fetch targets", async () => {
        await expect(
            fetchWorkspaceUrl({ url: "http://127.0.0.1/private" }),
        ).rejects.toThrow("Private network target");
        await expect(
            fetchWorkspaceUrl({ url: "http://localhost/private" }),
        ).rejects.toThrow("Private network target");
    });
});
