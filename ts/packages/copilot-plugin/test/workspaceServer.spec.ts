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
            path.join(workspace, "src", "lines.data"),
            Array.from({ length: 30 }, (_, index) => `line-${index + 1}`).join(
                "\n",
            ),
        );
        writeFileSync(
            path.join(workspace, "src", "binary.data"),
            Buffer.from([0x61, 0x00, 0x62]),
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

    it("reads later line ranges without applying maxBytes to the file prefix", async () => {
        await expect(
            readWorkspaceFile({
                path: "src/lines.data",
                startLine: 20,
                endLine: 21,
                maxBytes: 32,
            }),
        ).resolves.toEqual({
            path: "src/lines.data",
            startLine: 20,
            endLine: 21,
            truncated: true,
            text: "line-20\nline-21",
        });
    });

    it("rejects binary files", async () => {
        await expect(
            readWorkspaceFile({ path: "src/binary.data" }),
        ).rejects.toThrow("Binary files are not supported");
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

    it.each([
        ["decimal IPv4", "http://2852039166/private"],
        ["hexadecimal IPv4", "http://0xa9fea9fe/private"],
        ["octal IPv4", "http://0251.0376.0251.0376/private"],
        ["loopback subnet", "http://127.0.0.2/private"],
        ["carrier-grade NAT", "http://100.64.0.1/private"],
        ["IPv4-mapped IPv6", "http://[::ffff:169.254.169.254]/private"],
        ["Teredo", "http://[2001:0000::1]/private"],
        ["6to4", "http://[2002:a9fe:a9fe::]/private"],
        ["NAT64", "http://[64:ff9b::a9fe:a9fe]/private"],
        ["unique-local IPv6", "http://[fc00::1]/private"],
    ])("blocks %s fetch targets", async (_name, url) => {
        await expect(fetchWorkspaceUrl({ url })).rejects.toThrow(
            "Private network target",
        );
    });
});
