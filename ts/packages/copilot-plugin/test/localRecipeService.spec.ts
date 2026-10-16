// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalRecipeService } from "../src/extension/local-recipe-service.js";
import { connectToMacroOwner } from "../src/shared/macro-owner.js";

const originalData = process.env.TYPEAGENT_PLUGIN_DATA;
const originalOwner = process.env.TYPEAGENT_RECIPE_OWNER;
let directory: string;
let service: Awaited<ReturnType<typeof createLocalRecipeService>>;
const forbidden = jest.fn(async (): Promise<never> => {
    throw new Error("No tool/model call is allowed for an empty catalog.");
});
beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "local-recipe-service-"));
    process.env.TYPEAGENT_PLUGIN_DATA = directory;
    process.env.TYPEAGENT_RECIPE_OWNER = "plugin";
    forbidden.mockClear();
    service = await createLocalRecipeService({
        cwd: directory,
        sessionId: "native-session",
        report: (message) => {
            throw new Error(message);
        },
        replayHost: { inspectTool: forbidden, callTool: forbidden },
        learning: () => ({
            extract: forbidden,
            build: forbidden,
            generateGrammar: forbidden,
            validateGrammar: forbidden,
            buildProgram: forbidden,
        }),
        program: { execute: forbidden },
    });
});
afterEach(async () => {
    await service.close();
    if (originalData === undefined) delete process.env.TYPEAGENT_PLUGIN_DATA;
    else process.env.TYPEAGENT_PLUGIN_DATA = originalData;
    if (originalOwner === undefined) delete process.env.TYPEAGENT_RECIPE_OWNER;
    else process.env.TYPEAGENT_RECIPE_OWNER = originalOwner;
    await rm(directory, { recursive: true, force: true });
});

test("canonical macro commands and ordinary misses need no TypeAgent or model", async () => {
    const client = await connectToMacroOwner(directory, "native-session");
    await expect(client.listMacros()).resolves.toEqual([]);
    await expect(
        client.getMacroRecordingState("native-session"),
    ).resolves.toEqual({ status: "idle" });
    await expect(
        service.matchAndRun("read alpha", "unmatched"),
    ).resolves.toEqual({ status: "miss" });
    await client.close();
    await expect(service.connection.listMacros()).resolves.toEqual([]);
    expect(forbidden).not.toHaveBeenCalled();
});
test("blocks reflected methods, malformed arguments, cross-session and cross-workspace mutation", async () => {
    await expect(service.dispatch("constructor", [])).rejects.toThrow(
        "Unsupported",
    );
    await expect(
        service.dispatch("runMacro", [
            { macroId: "saved", runId: "run", timeoutMs: -1 },
        ]),
    ).rejects.toThrow();
    await expect(
        service.dispatch("getMacroRecordingState", ["different"]),
    ).rejects.toThrow("another native session");
    await expect(
        service.dispatch("setMacroLearningPreference", [
            { cwd: join(directory, "other"), mode: "all" },
        ]),
    ).rejects.toThrow("another workspace");
    expect(forbidden).not.toHaveBeenCalled();
});
test("owner rollback stops new local admissions without mutating either catalog", async () => {
    process.env.TYPEAGENT_RECIPE_OWNER = "off";
    await expect(service.dispatch("listMacros", [null])).rejects.toThrow(
        "inactive",
    );
    await expect(
        connectToMacroOwner(directory, "native-session"),
    ).rejects.toThrow("disabled");
    expect(forbidden).not.toHaveBeenCalled();
});
