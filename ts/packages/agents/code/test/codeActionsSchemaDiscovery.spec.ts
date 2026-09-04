// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Proves that getGitDiff is discoverable through the same catalog pipeline
 * external MCP clients use (e.g. commandExecutor's discover_agents/execute_action,
 * which read schemas via Dispatcher.getAgentSchemas -> ParsedActionSchema.actionSchemas).
 *
 * This parses the real codeActionsSchema.ts source with the same
 * @typeagent/action-schema APIs used to build/round-trip the compiled
 * dist/codeSchema.pas.json catalog artifact (see
 * packages/actionSchema/test/regen.spec.ts, which already round-trips this
 * exact schema as part of its generic per-agent coverage). Rather than
 * duplicate that generic round-trip, this test asserts the specific,
 * externally-visible shape (name/description/parameters) of the new action.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    parseActionSchemaSource,
    getActionDescription,
    getParameterNames,
} from "@typeagent/action-schema";

// This spec compiles to dist/test/*.js, so the source tree (../src from the
// package root) is two levels up from there.
const schemaPath = fileURLToPath(
    new URL("../../src/codeActionsSchema.ts", import.meta.url),
);

describe("code agent action catalog discoverability", () => {
    const source = fs.readFileSync(schemaPath, "utf-8");
    const parsed = parseActionSchemaSource(
        source,
        "code",
        { action: "CodeActions", activity: "CodeActivity" },
        path.basename(schemaPath),
    );

    it("includes getGitDiff with a concise, standalone description", () => {
        const actionDef = parsed.actionSchemas.get("getGitDiff");
        expect(actionDef).toBeDefined();
        expect(getActionDescription(actionDef!)).toBe(
            "Get the actual Git diff for the workspace: changed files plus bounded unified-patch/hunk text, split into staged and unstaged sections by default.",
        );
    });

    it("exposes getGitDiff's base and repository parameters", () => {
        const actionDef = parsed.actionSchemas.get("getGitDiff")!;
        const names = getParameterNames(actionDef, () => undefined).sort();
        expect(names).toEqual(["parameters.base", "parameters.repository"]);
    });

    it("still includes getWorkspaceChanges (compatibility)", () => {
        const actionDef = parsed.actionSchemas.get("getWorkspaceChanges");
        expect(actionDef).toBeDefined();
        expect(getActionDescription(actionDef!)).toBeTruthy();
    });
});
