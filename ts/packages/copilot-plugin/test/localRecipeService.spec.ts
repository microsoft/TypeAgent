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
    delete process.env.TYPEAGENT_RECIPE_OWNER;
    forbidden.mockClear();
    service = await createLocalRecipeService({
        cwd: directory,
        sessionId: "native-session",
        report: (message) => {
            throw new Error(message);
        },
        replayHost: { inspectTool: forbidden, callTool: forbidden },
        learning: () => ({
            withAuthorQuery: () => {
                throw new Error("An empty catalog cannot request authorship.");
            },
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
test("MCP resolves its actual native session workspace independently of process cwd", async () => {
    expect(process.cwd()).not.toBe(directory);
    const client = await connectToMacroOwner(undefined, "native-session");
    await expect(client.listMacros()).resolves.toEqual([]);
    await expect(
        connectToMacroOwner(undefined, "another-session"),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await service.close();
    await expect(
        connectToMacroOwner(undefined, "native-session"),
    ).rejects.toMatchObject({ code: "ENOENT" });
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
test("disabling stops new local admissions without selecting another catalog", async () => {
    process.env.TYPEAGENT_RECIPE_OWNER = "off";
    await expect(service.dispatch("listMacros", [null])).rejects.toThrow(
        "inactive",
    );
    await expect(
        connectToMacroOwner(directory, "native-session"),
    ).rejects.toThrow("disabled");
    expect(forbidden).not.toHaveBeenCalled();
});

test("disable during selected recording blocks finalization and author claims without fallback", async () => {
    await service.connection.setMacroLearningPreference({
        cwd: directory,
        mode: "prepare",
    });
    const token = await service.connection.armMacroRecording({
        sessionId: "native-session",
        cwd: directory,
        learning: true,
    });
    await service.connection.claimMacroRecording({
        sessionId: "native-session",
        cwd: directory,
        promptHash: "a".repeat(64),
    });
    process.env.TYPEAGENT_RECIPE_OWNER = "off";
    expect(() =>
        service.authoringConnection.claimMacroAuthoringRequest({
            sessionId: "native-session",
            cwd: directory,
            workerId: "worker",
        }),
    ).toThrow("inactive");
    await expect(
        service.dispatch("claimMacroRecording", [
            {
                sessionId: "native-session",
                cwd: directory,
                promptHash: "a".repeat(64),
            },
        ]),
    ).rejects.toThrow("inactive");
    await expect(
        service.connection.finalizeMacroRecording({
            tokenId: token.id,
            trace: {
                schemaVersion: 1,
                sessionId: "native-session",
                cwd: directory,
                prompt: "read alpha",
                response: "alpha",
                startedAt: "2026-10-16T00:00:00.000Z",
                completedAt: "2026-10-16T00:00:01.000Z",
                toolCalls: [],
            },
        }),
    ).rejects.toThrow("inactive");
    expect(forbidden).not.toHaveBeenCalled();
    delete process.env.TYPEAGENT_RECIPE_OWNER;
    expect(
        await service.connection.getMacroRecordingState("native-session"),
    ).toMatchObject({
        status: "claimed",
        token: { id: token.id },
    });
    await service.connection.cancelMacroRecording("native-session");
    expect(
        await service.connection.getMacroRecordingState("native-session"),
    ).toEqual({ status: "idle" });
});
