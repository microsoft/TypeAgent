// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateFocusedWorkspaceCommand } from "../workspaceCommandPolicy";

const workspaceRoot = path.resolve(__dirname, "../../../..");
const workspaceCwd = path.join(workspaceRoot, "packages", "coda");

test("allows focused test and build commands", () => {
    assert.equal(
        validateFocusedWorkspaceCommand("pnpm test -- --runInBand"),
        undefined,
    );
    assert.equal(
        validateFocusedWorkspaceCommand("dotnet build project.sln"),
        undefined,
    );
    assert.equal(
        validateFocusedWorkspaceCommand("vitest run src/example.spec.ts"),
        undefined,
    );
});

test("rejects path arguments outside the workspace root", () => {
    for (const command of [
        "npm test --prefix ../../..",
        "jest --config ../../../config.js",
        "pytest -c../../../outside.ini",
        "tsc -p../../..",
        "pytest ../../../outside=test.py",
        `tsc --project "${path.resolve(
            workspaceRoot,
            "..",
            "outside",
            "tsconfig.json",
        )}"`,
    ]) {
        assert.match(
            validateFocusedWorkspaceCommand(
                command,
                workspaceCwd,
                workspaceRoot,
            ) ?? "",
            /must stay within/,
        );
    }
});

test("allows path arguments that remain inside the workspace root", () => {
    assert.equal(
        validateFocusedWorkspaceCommand(
            "vitest run ./src/example.spec.ts",
            workspaceCwd,
            workspaceRoot,
        ),
        undefined,
    );
    assert.equal(
        validateFocusedWorkspaceCommand(
            "tsc --project ../../tsconfig.json",
            workspaceCwd,
            workspaceRoot,
        ),
        undefined,
    );
});

test("rejects a bare symlink argument that resolves outside the workspace", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coda-policy-"));
    try {
        const root = path.join(tempRoot, "workspace");
        const cwd = path.join(root, "package");
        const outside = path.join(tempRoot, "outside");
        fs.mkdirSync(cwd, { recursive: true });
        fs.mkdirSync(outside);
        fs.symlinkSync(outside, path.join(cwd, "outside-link"), "junction");

        assert.match(
            validateFocusedWorkspaceCommand("pytest outside-link", cwd, root) ??
                "",
            /must stay within/,
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test("rejects shell composition and non-focused commands", () => {
    for (const command of [
        "  rm -rf target",
        "echo preparing\nrm -rf target",
        "sh -c 'rm -rf target'",
        "powershell Remove-Item -Recurse target",
        "pnpm test && rm -rf target",
        "pytest ~/outside.py",
        "pytest %USERPROFILE%\\outside.py",
        "pytest *.py",
        "bun x cowsay",
        "bun run ./script.ts",
    ]) {
        assert.notEqual(validateFocusedWorkspaceCommand(command), undefined);
    }
});
