// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import test from "node:test";
import { validateFocusedWorkspaceCommand } from "../workspaceCommandPolicy";

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

test("rejects shell composition and non-focused commands", () => {
    for (const command of [
        "  rm -rf target",
        "echo preparing\nrm -rf target",
        "sh -c 'rm -rf target'",
        "powershell Remove-Item -Recurse target",
        "pnpm test && rm -rf target",
        "bun x cowsay",
        "bun run ./script.ts",
    ]) {
        assert.notEqual(validateFocusedWorkspaceCommand(command), undefined);
    }
});
