// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseRecordingDirective } from "@typeagent/dispatcher-types";
import { resolveActiveSchemaScope } from "../src/translation/activeSchemaScope.js";
import { getReasoningProfileGuidance } from "../src/reasoning/reasoningProfile.js";
import { createDispatcher } from "../src/dispatcher.js";
import { awaitCommand, type Dispatcher } from "@typeagent/dispatcher-types";

describe("dev action routing", () => {
    describe("recording directives", () => {
        it.each([
            ["learn: list large files", "learn", false, "list large files"],
            [
                "remember how to list large files",
                "learn",
                false,
                "list large files",
            ],
            ["record: list large files", "record", false, "list large files"],
            ["record list large files", "record", false, "list large files"],
            ["dev: learn: list large files", "learn", true, "list large files"],
            [
                "dev: record list large files",
                "record",
                true,
                "list large files",
            ],
        ])("parses %s", (request, kind, dev, task) => {
            expect(parseRecordingDirective(request)).toMatchObject({
                kind,
                dev,
                task,
            });
        });

        it("preserves the legacy bare dev prefix", () => {
            expect(parseRecordingDirective("dev: list large files")).toEqual({
                kind: "record",
                dev: true,
                task: "list large files",
                legacyDevPrefix: true,
            });
        });

        it("does not classify ordinary requests", () => {
            expect(parseRecordingDirective("list large files")).toBeUndefined();
        });
    });

    describe("active schema scope", () => {
        it("returns the full active set when no scope is requested", () => {
            expect(resolveActiveSchemaScope(["powershell", "browser"])).toEqual(
                {
                    schemaNames: ["powershell", "browser"],
                    unavailable: [],
                },
            );
        });

        it("deduplicates a valid requested scope", () => {
            expect(
                resolveActiveSchemaScope(
                    ["powershell", "browser"],
                    ["powershell", "powershell"],
                ),
            ).toEqual({
                schemaNames: ["powershell"],
                unavailable: [],
            });
        });

        it("reports unavailable requested schemas", () => {
            expect(
                resolveActiveSchemaScope(["browser"], ["powershell"]),
            ).toEqual({
                schemaNames: [],
                unavailable: ["powershell"],
            });
        });
    });

    it("adds focused PowerShell recording guidance", () => {
        const guidance = getReasoningProfileGuidance({
            reasoningProfile: "powershellFlowRecording",
        });
        expect(guidance).toContain("createPowerShellFlow");
        expect(guidance).toContain("Do not create a TaskFlow or WebFlow");
    });

    describe("dispatcher disposition", () => {
        let dispatcher: Dispatcher;

        beforeAll(async () => {
            dispatcher = await createDispatcher("dev-action-routing-test", {
                agents: {
                    actions: false,
                    schemas: false,
                },
                translation: { enabled: false },
                explainer: { enabled: false },
                cache: { enabled: false },
                collectCommandResult: true,
            });
        });

        afterAll(async () => {
            await dispatcher.close();
        });

        it("returns notHandled when the requested schema is inactive", async () => {
            const result = await awaitCommand(
                dispatcher,
                "list large files",
                undefined,
                {
                    activeSchemas: ["powershell"],
                    noReasoning: true,
                },
            );

            expect(result?.disposition).toEqual({
                status: "notHandled",
                reason: "noActiveSchema",
            });
        });
    });
});
