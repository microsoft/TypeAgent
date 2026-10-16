// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DurableRecipeCatalog } from "@typeagent/copilot-macros/recipeCatalog";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
    getRecipeCommandScope,
    handleRecipeCommand,
} from "../src/shared/recipe-commands.js";

const input = { sessionId: "recipe-test", timestamp: 1, cwd: ".", prompt: "" };
let directory: string;
const originalData = process.env.TYPEAGENT_PLUGIN_DATA;
const originalProfile = process.env.TYPEAGENT_RECIPE_PROFILE_ID;

beforeEach(() => {
    directory = resolve(".recipe-command-tests", randomUUID());
    mkdirSync(directory, { recursive: true });
    process.env.TYPEAGENT_PLUGIN_DATA = directory;
    delete process.env.TYPEAGENT_RECIPE_PROFILE_ID;
});
afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    if (originalData === undefined) delete process.env.TYPEAGENT_PLUGIN_DATA;
    else process.env.TYPEAGENT_PLUGIN_DATA = originalData;
    if (originalProfile === undefined)
        delete process.env.TYPEAGENT_RECIPE_PROFILE_ID;
    else process.env.TYPEAGENT_RECIPE_PROFILE_ID = originalProfile;
});

test("ordinary prompts and legacy modes do not create/open recipe storage", async () => {
    for (const prompt of [
        "hello",
        "@typeagent mode direct",
        "@typeagent recipes status",
        "@typeagent macro status",
    ])
        expect(await handleRecipeCommand({ ...input, prompt })).toBeUndefined();
    expect(existsSync(join(directory, "recipes"))).toBe(false);
});

test("recognized malformed commands return usage with no mutation", async () => {
    for (const prompt of [
        "@typeagent recipe",
        "@typeagent recipe run unsafe",
        "@typeagent recipe delete id",
        "@typeagent recipe disable id revision extra",
        "@typeagent recipe cancel missing",
        "@typeagent recipe list\nextra",
    ])
        expect(
            (await handleRecipeCommand({ ...input, prompt }))?.responseContent,
        ).toContain("Local recipe commands");
    expect(existsSync(join(directory, "recipes"))).toBe(false);
});

test("local status/list operate without a TypeAgent connection and report P3 gate", async () => {
    const status = await handleRecipeCommand({
        ...input,
        prompt: "@typeagent recipe status",
    });
    expect(status).toMatchObject({ handled: true, handledBy: "typeagent" });
    expect(status?.responseContent).toContain(
        "Plugin-local program execution is not enabled.",
    );
    expect(status?.responseContent).toContain("local-default");
    expect(
        (
            await handleRecipeCommand({
                ...input,
                prompt: "@typeagent recipe list",
            })
        )?.responseContent,
    ).toBe("[]");
});

test("unknown IDs/cancel return explicit local failure, not legacy fallback", async () => {
    for (const prompt of [
        "@typeagent recipe disable missing revision",
        "@typeagent recipe delete missing revision",
        "@typeagent recipe cancel job missing",
        "@typeagent recipe cancel run missing",
    ]) {
        const result = await handleRecipeCommand({ ...input, prompt });
        expect(result?.handled).toBe(true);
        expect(result?.responseContent).toContain("failed locally");
    }
});

test("catalog initialization failure is handled without retrying another backend", async () => {
    process.env.TYPEAGENT_PLUGIN_DATA = join(directory, "invalid");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(process.env.TYPEAGENT_PLUGIN_DATA, "not a directory");
    expect(
        (
            await handleRecipeCommand({
                ...input,
                prompt: "@typeagent recipe status",
            })
        )?.responseContent,
    ).toContain("failed locally");
});

test("explicit profile/workspace scope cannot list another catalog's work", async () => {
    const scope = getRecipeCommandScope(input.cwd);
    const catalog = new DurableRecipeCatalog(join(directory, "recipes"));
    try {
        await catalog.setLearningMode(scope, "prepare");
        expect((await catalog.snapshot(scope)).catalogRevision).toBe(1);
    } finally {
        catalog.close();
    }
    process.env.TYPEAGENT_RECIPE_PROFILE_ID = "other";
    const result = await handleRecipeCommand({
        ...input,
        prompt: "@typeagent recipe status",
    });
    expect(result?.responseContent).toContain('"catalogRevision": 0');
    expect(getRecipeCommandScope("another-workspace").workspaceId).not.toBe(
        scope.workspaceId,
    );
});
