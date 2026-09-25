// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    assertGhcpEvalAction,
    ghcpEvalExecutionStopped,
    isGhcpEvalReadOnlyAction,
    isGhcpEvalRecoverableReadError,
    markGhcpEvalExecutionFailure,
} from "../src/execute/ghcpEvalPolicy.js";

describe("isolated GHCP evaluation action policy", () => {
    it("allows affirmative read failures without clearing a prior terminal stop", () => {
        const original = process.env.TYPEAGENT_GHCP_EVAL_FIXTURES;
        try {
            process.env.TYPEAGENT_GHCP_EVAL_FIXTURES = "fixture";
            const recoverable =
                isGhcpEvalReadOnlyAction("github-cli", "prFiles") &&
                isGhcpEvalRecoverableReadError("ECONNRESET: socket closed");
            expect(recoverable).toBe(true);
            markGhcpEvalExecutionFailure(recoverable);
            expect(ghcpEvalExecutionStopped()).toBe(false);
            expect(() =>
                assertGhcpEvalAction("github-cli", "prChecks", {}),
            ).not.toThrow();
            markGhcpEvalExecutionFailure();
            markGhcpEvalExecutionFailure(recoverable);
            expect(ghcpEvalExecutionStopped()).toBe(true);
        } finally {
            if (original === undefined)
                delete process.env.TYPEAGENT_GHCP_EVAL_FIXTURES;
            else process.env.TYPEAGENT_GHCP_EVAL_FIXTURES = original;
        }
    });
    it("does not infer safe recovery from mutations, missing errors, denial or cancellation", () => {
        expect(isGhcpEvalReadOnlyAction("list", "clearList")).toBe(false);
        expect(isGhcpEvalReadOnlyAction("ipconfig", "releaseAddress")).toBe(
            false,
        );
        for (const error of [
            undefined,
            "",
            "unknown failure",
            "permission denied: ENOENT",
            "cancelled after ECONNRESET",
            "execution_uncertain: ETIMEDOUT",
        ])
            expect(isGhcpEvalRecoverableReadError(error)).toBe(false);
        expect(isGhcpEvalRecoverableReadError("ENOENT: missing file")).toBe(
            true,
        );
    });
    it("stops subsequent execution after failure only in the isolated eval process", () => {
        const original = process.env.TYPEAGENT_GHCP_EVAL_FIXTURES;
        try {
            process.env.TYPEAGENT_GHCP_EVAL_FIXTURES = "fixture";
            markGhcpEvalExecutionFailure();
            expect(ghcpEvalExecutionStopped()).toBe(true);
            expect(() => assertGhcpEvalAction("list", "addItems", {})).toThrow(
                "stopped execution",
            );
            delete process.env.TYPEAGENT_GHCP_EVAL_FIXTURES;
            expect(ghcpEvalExecutionStopped()).toBe(false);
            expect(() =>
                assertGhcpEvalAction("any", "normal", {}),
            ).not.toThrow();
        } finally {
            if (original === undefined)
                delete process.env.TYPEAGENT_GHCP_EVAL_FIXTURES;
            else process.env.TYPEAGENT_GHCP_EVAL_FIXTURES = original;
        }
    });
    it.each([
        ["github-cli", "issueClose"],
        ["ipconfig", "releaseAddress"],
        ["powershell", "executeScript"],
    ])("blocks %s.%s before effects", (schema, action) => {
        expect(() =>
            assertGhcpEvalAction(schema, action, {}, "fixture"),
        ).toThrow("before execution");
    });
    it("permits the intended read-only external actions and disposable lists", () => {
        expect(() =>
            assertGhcpEvalAction("github-cli", "prFiles", {}, "fixture"),
        ).not.toThrow();
        expect(() =>
            assertGhcpEvalAction(
                "ipconfig",
                "displayDNSResolverCacheContents",
                {},
                "fixture",
            ),
        ).not.toThrow();
        expect(() =>
            assertGhcpEvalAction("list", "clearList", {}, "fixture"),
        ).not.toThrow();
    });
    it("permits only canonical registered fixture paths", () => {
        const folder = fs.mkdtempSync(
            path.join(os.tmpdir(), "ghcp-policy-test-"),
        );
        try {
            for (const file of [
                "report-a.txt",
                "report-b.txt",
                "trip.txt",
                "unrelated.txt",
            ]) {
                fs.writeFileSync(path.join(folder, file), "");
            }
            expect(() =>
                assertGhcpEvalAction(
                    "powershell.powershell-files",
                    "readFile",
                    { path: path.join(folder, "report-a.txt") },
                    folder,
                ),
            ).not.toThrow();
            expect(() =>
                assertGhcpEvalAction(
                    "powershell.powershell-files",
                    "readFile",
                    { path: path.join(folder, "unrelated.txt") },
                    folder,
                ),
            ).toThrow("before execution");
        } finally {
            fs.rmSync(folder, { recursive: true });
        }
    });
});
