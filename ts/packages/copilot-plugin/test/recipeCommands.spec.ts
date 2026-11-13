// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { MacroOwnerConnection } from "../src/shared/macro-owner.js";
import type { RunMacroRequest } from "@typeagent/copilot-macros";
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
const originalOwner = process.env.TYPEAGENT_RECIPE_OWNER;
const missing = async () => {
    throw new Error("Unknown saved recipe.");
};
function connection(
    overrides: Partial<MacroOwnerConnection> = {},
): MacroOwnerConnection {
    return {
        close: async () => {},
        listMacros: async () => [],
        getMacroRecordingState: async () => ({ status: "idle" }),
        getMacroLearningPreference: missing,
        setMacroLearningPreference: missing,
        getMacroLearningJob: missing,
        cancelMacroLearningJob: missing,
        armMacroRecording: missing,
        claimMacroRecording: missing,
        cancelMacroRecording: missing,
        failMacroRecording: missing,
        finalizeMacroRecording: missing,
        searchMacros: missing,
        inspectMacro: missing,
        getMacroRequirements: missing,
        validateMacro: missing,
        approveMacro: missing,
        reviseMacro: missing,
        disableMacro: missing,
        deleteMacro: missing,
        runMacro: missing,
        cancelMacroRun: missing,
        getMacroRun: missing,
        ...overrides,
    };
}
const connect = async () => connection();

beforeEach(() => {
    directory = resolve(".recipe-command-tests", randomUUID());
    mkdirSync(directory, { recursive: true });
    process.env.TYPEAGENT_PLUGIN_DATA = directory;
    delete process.env.TYPEAGENT_RECIPE_PROFILE_ID;
    delete process.env.TYPEAGENT_RECIPE_OWNER;
});
afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
    if (originalData === undefined) delete process.env.TYPEAGENT_PLUGIN_DATA;
    else process.env.TYPEAGENT_PLUGIN_DATA = originalData;
    if (originalProfile === undefined)
        delete process.env.TYPEAGENT_RECIPE_PROFILE_ID;
    else process.env.TYPEAGENT_RECIPE_PROFILE_ID = originalProfile;
    if (originalOwner === undefined) delete process.env.TYPEAGENT_RECIPE_OWNER;
    else process.env.TYPEAGENT_RECIPE_OWNER = originalOwner;
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
        "@typeagent recipe revise id 1",
        "@typeagent recipe revise id 0 feedback",
    ])
        expect(
            (await handleRecipeCommand({ ...input, prompt }))?.responseContent,
        ).toContain("Recipe commands");
    expect(existsSync(join(directory, "recipes"))).toBe(false);
});

test("status/list use the selected owner's real macro catalog, not a SQLite mirror", async () => {
    const status = await handleRecipeCommand(
        {
            ...input,
            prompt: "@typeagent recipe status",
        },
        connect,
    );
    expect(status).toMatchObject({ handled: true, handledBy: "typeagent" });
    expect(status?.responseContent).toContain('"owner": "plugin"');
    expect(status?.responseContent).toContain("local-default");
    expect(
        (
            await handleRecipeCommand(
                {
                    ...input,
                    prompt: "@typeagent recipe list",
                },
                connect,
            )
        )?.responseContent,
    ).toBe("[]");
});

test("unknown IDs/cancel return explicit local failure, not legacy fallback", async () => {
    for (const prompt of [
        "@typeagent recipe disable missing 1",
        "@typeagent recipe delete missing 1",
        "@typeagent recipe cancel job missing",
        "@typeagent recipe cancel run missing",
        "@typeagent recipe revise missing 1 Clarify the output",
        "@typeagent recipe status missing",
    ]) {
        const result = await handleRecipeCommand({ ...input, prompt }, connect);
        expect(result?.handled).toBe(true);
        expect(result?.responseContent).toContain("failed");
    }
});

test("owner connection failure is handled without retrying another backend", async () => {
    const unavailable = jest.fn(async () => {
        throw new Error("owner unavailable");
    });
    expect(
        (
            await handleRecipeCommand(
                {
                    ...input,
                    prompt: "@typeagent recipe status",
                },
                unavailable,
            )
        )?.responseContent,
    ).toContain("owner unavailable");
    expect(unavailable).toHaveBeenCalledTimes(1);
});

test("reports the current workspace/profile scope", async () => {
    const scope = getRecipeCommandScope(input.cwd);
    process.env.TYPEAGENT_RECIPE_PROFILE_ID = "other";
    const result = await handleRecipeCommand(
        {
            ...input,
            prompt: "@typeagent recipe status",
        },
        connect,
    );
    expect(result?.responseContent).toContain('"profileId": "other"');
    expect(getRecipeCommandScope("another-workspace").workspaceId).not.toBe(
        scope.workspaceId,
    );
});

test("explicit execution preserves JSON string whitespace and preallocates a run identity", async () => {
    let request: RunMacroRequest | undefined;
    const client = connection({
        runMacro: async (value) => {
            request = value;
            throw new Error("Injected fixture stops before any task call.");
        },
    });
    const result = await handleRecipeCommand(
        {
            ...input,
            prompt: '@typeagent recipe run saved 2 {"text":"two  spaces","number":7}',
        },
        async () => client,
    );
    expect(result?.handled).toBe(true);
    expect(request).toMatchObject({
        macroId: "saved",
        version: 2,
        runId: expect.any(String),
        inputs: { text: "two  spaces", number: 7 },
    });
});

test("review corrections preserve plain-language spacing and return the revision job without approving or running", async () => {
    const job = {
        jobId: "job",
        traceId: "trace",
        cwd: input.cwd,
        sessionId: input.sessionId,
        mode: "prepare" as const,
        status: "queued" as const,
        createdAt: "2026-10-27T00:00:00Z",
        updatedAt: "2026-10-27T00:00:00Z",
        authoring: {
            captureId: "trace",
            taskId: "task",
            tokenId: "token",
            contextDigest: "a".repeat(64),
        },
    };
    const reviseMacro = jest.fn<MacroOwnerConnection["reviseMacro"]>(
        async () => job,
    );
    const getMacroLearningJob = jest.fn<
        MacroOwnerConnection["getMacroLearningJob"]
    >(async () => job);
    const approveMacro = jest.fn(missing);
    const runMacro = jest.fn(missing);
    const client = connection({
        reviseMacro,
        getMacroLearningJob,
        approveMacro,
        runMacro,
    });
    const result = await handleRecipeCommand(
        {
            ...input,
            prompt: "@typeagent recipe revise saved 3 Keep  two spaces\nand return only the title",
        },
        async () => client,
    );
    expect(reviseMacro).toHaveBeenCalledWith({
        macroId: "saved",
        version: 3,
        feedback: "Keep  two spaces\nand return only the title",
    });
    expect(result?.responseContent).toContain('"jobId": "job"');
    expect(result?.responseContent).toContain("Revision queued");
    expect(result?.responseContent).toContain("needsReview");
    const status = await handleRecipeCommand(
        { ...input, prompt: "@typeagent recipe status job" },
        async () => client,
    );
    expect(JSON.parse(status!.responseContent!)).toEqual(job);
    expect(getMacroLearningJob).toHaveBeenCalledWith("job");
    expect(approveMacro).not.toHaveBeenCalled();
    expect(runMacro).not.toHaveBeenCalled();
    const unsafe = await handleRecipeCommand(
        {
            ...input,
            prompt: "@typeagent recipe revise saved 9007199254740992 change it",
        },
        async () => client,
    );
    expect(unsafe?.responseContent).toContain("positive integer");
    expect(reviseMacro).toHaveBeenCalledTimes(1);
});

test("off does not connect to either catalog or backend", async () => {
    process.env.TYPEAGENT_RECIPE_OWNER = "off";
    const never = jest.fn(connect);
    expect(
        (
            await handleRecipeCommand(
                { ...input, prompt: "@typeagent recipe list" },
                never,
            )
        )?.responseContent,
    ).toContain("off");
    expect(never).not.toHaveBeenCalled();
});
