// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    evaluateBoundPathAdoption,
    type BoundPathAdoptionDeps,
} from "../src/agent/boundPathAdoption.js";
import {
    resolveExistingFileWithinRoot,
    resolveRealDirectory,
} from "../src/agent/pathPolicy.js";

// Direct coverage for adoptBoundPathFromView's gating logic. The pure
// helper decides whether the view-reported binding may be adopted; the
// agent-side caller only assigns to agentContext when the helper returns
// a target. Testing the helper directly therefore proves both branches
// of "rejected recovery returns no binding" (undefined return) and
// "accepted recovery preserves full nested relative path" (relativePath
// keeps its nested segments), without spinning up a view process or
// leaking process-global state between tests.

describe("evaluateBoundPathAdoption (authorized recovery gating)", () => {
    let temporaryDirectory: string;
    let workspaceRoot: string;
    let authorizedRoots: Set<string>;
    let authorizeCalls: string[];
    let deps: BoundPathAdoptionDeps;

    beforeEach(() => {
        temporaryDirectory = fs.mkdtempSync(
            path.join(os.tmpdir(), "typeagent-markdown-adopt-"),
        );
        workspaceRoot = path.join(temporaryDirectory, "workspace");
        fs.mkdirSync(workspaceRoot);
        authorizedRoots = new Set<string>();
        authorizeCalls = [];
        deps = {
            resolveRealDirectory,
            resolveExistingFileWithinRoot,
            isAuthorizedRoot: (canonicalRoot: string) =>
                authorizedRoots.has(canonicalRoot),
            authorizeRoot: (canonicalRoot: string) => {
                authorizeCalls.push(canonicalRoot);
                authorizedRoots.add(canonicalRoot);
            },
        };
    });

    afterEach(() => {
        fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    });

    test("adopts an in-process authorized root and preserves the full nested relative path", () => {
        const canonicalRoot = fs.realpathSync(workspaceRoot);
        // Pre-authorize the canonical root as if a prior create/open under
        // a trusted ActionContext.workingDirectory had accepted it.
        authorizedRoots.add(canonicalRoot);

        const nestedDir = path.join(canonicalRoot, "notes", "2025");
        fs.mkdirSync(nestedDir, { recursive: true });
        const nestedFile = path.join(nestedDir, "plan.md");
        fs.writeFileSync(nestedFile, "body");

        // Simulate a recovery call that arrived without a workingDirectory
        // (the UI-synthesized ActionContext case). Authorization must
        // come from the pre-populated authorized set alone.
        const target = evaluateBoundPathAdoption(
            {
                boundFilePath: nestedFile,
                boundRoot: canonicalRoot,
                boundRelativePath: "notes/2025/plan.md",
            },
            undefined,
            deps,
        );

        expect(target).toEqual({
            canonicalRoot,
            relativePath: "notes/2025/plan.md",
            resolvedAbsolute: fs.realpathSync(nestedFile),
        });
        // The helper must not silently authorize on the recovery path
        // when no workingDirectory was supplied. Authorization can only
        // come from the pre-populated set here.
        expect(authorizeCalls).toEqual([]);
    });

    test("rejects an unapproved reported root and yields no binding when ActionContext has no workingDirectory", () => {
        const canonicalRoot = fs.realpathSync(workspaceRoot);
        const targetFile = path.join(canonicalRoot, "orphan.md");
        fs.writeFileSync(targetFile, "body");

        // authorizedRoots is empty and no workingDirectory is supplied.
        // A UI-synthesized ActionContext must never widen the trust
        // boundary on its own, so recovery must fail closed.
        const target = evaluateBoundPathAdoption(
            {
                boundFilePath: targetFile,
                boundRoot: canonicalRoot,
                boundRelativePath: "orphan.md",
            },
            undefined,
            deps,
        );

        expect(target).toBeUndefined();
        // Authorization must not be granted as a side effect of a
        // rejected recovery: the set stays empty and no authorizeRoot
        // call was issued.
        expect(authorizeCalls).toEqual([]);
        expect(authorizedRoots.size).toBe(0);
    });
});
