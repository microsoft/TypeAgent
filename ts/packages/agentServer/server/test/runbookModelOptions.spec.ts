// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { FileMemoryServiceOptions } from "@typeagent/memory-service";

const constructors: Array<{ root: string; options: FileMemoryServiceOptions }> =
    [];
const hasEndpoint = jest.fn<(endpoint: string) => boolean>();
const createChatModel = jest.fn();
jest.unstable_mockModule("@typeagent/aiclient", () => ({
    openai: { hasChatModelEndpoint: hasEndpoint, createChatModel },
    PROVIDER_MODES: ["azure", "openai", "copilot", "ollama"],
}));
jest.unstable_mockModule("@typeagent/conversation-memory", () => ({
    createDocMemorySettings: jest.fn(),
}));
jest.unstable_mockModule("@typeagent/memory-service", () => ({
    FileMemoryService: class {
        public constructor(root: string, options: FileMemoryServiceOptions) {
            constructors.push({ root, options });
        }
    },
    createKnowProCorpusIndex: jest.fn(),
}));
const { getConfiguredRunbookModelOptions } = await import(
    "../src/runbookModelOptions.js"
);
const { createDurableMemoryService } = await import(
    "../src/durableMemoryService.js"
);

describe("explicit configured runbook image capability", () => {
    const originalEndpoint = process.env.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT;
    const originalDeclaration = process.env.TYPEAGENT_RUNBOOK_MULTIMODAL;

    beforeEach(() => {
        constructors.length = 0;
        hasEndpoint.mockReset().mockReturnValue(true);
        createChatModel.mockClear();
        delete process.env.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT;
        delete process.env.TYPEAGENT_RUNBOOK_MULTIMODAL;
    });
    afterAll(() => {
        if (originalEndpoint === undefined)
            delete process.env.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT;
        else process.env.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT = originalEndpoint;
        if (originalDeclaration === undefined)
            delete process.env.TYPEAGENT_RUNBOOK_MULTIMODAL;
        else process.env.TYPEAGENT_RUNBOOK_MULTIMODAL = originalDeclaration;
    });

    test("keeps unknown/default models manual without endpoint discovery or model creation", () => {
        expect(getConfiguredRunbookModelOptions({})).toEqual({
            runbookMultimodal: false,
        });
        expect(hasEndpoint).not.toHaveBeenCalled();
        expect(createChatModel).not.toHaveBeenCalled();
    });

    test("does not infer capability from a vision-looking model name", () => {
        expect(
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "azure:GPT_4_O",
            }),
        ).toEqual({
            runbookModelEndpoint: "azure:GPT_4_O",
            runbookMultimodal: false,
        });
        expect(hasEndpoint).not.toHaveBeenCalled();
    });

    test("retains a configured unsupported text model while disabling image input", () => {
        expect(
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "azure:TEXT_ONLY",
                TYPEAGENT_RUNBOOK_MULTIMODAL: "false",
            }),
        ).toEqual({
            runbookModelEndpoint: "azure:TEXT_ONLY",
            runbookMultimodal: false,
        });
        expect(hasEndpoint).not.toHaveBeenCalled();
    });

    test("checks the explicit configured route for operator-declared image support", () => {
        expect(
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "azure:VERIFIED_VISION",
                TYPEAGENT_RUNBOOK_MULTIMODAL: "true",
            }),
        ).toEqual({
            runbookModelEndpoint: "azure:VERIFIED_VISION",
            runbookMultimodal: true,
        });
        expect(hasEndpoint).toHaveBeenCalledWith("azure:VERIFIED_VISION");
        expect(createChatModel).not.toHaveBeenCalled();
    });

    test("rejects an unconfigured declared image route instead of using a fallback", () => {
        hasEndpoint.mockReturnValue(false);
        expect(() =>
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: "azure:MISSING",
                TYPEAGENT_RUNBOOK_MULTIMODAL: "true",
            }),
        ).toThrow("not configured");
        expect(createChatModel).not.toHaveBeenCalled();
    });

    test("requires a scoped endpoint rather than asserting default-model image support", () => {
        expect(() =>
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MULTIMODAL: "true",
            }),
        ).toThrow("explicit TYPEAGENT_RUNBOOK_MODEL_ENDPOINT");
        expect(hasEndpoint).not.toHaveBeenCalled();
    });

    test.each([
        "GPT_4_O",
        "azure",
        "azure:",
        "copilot:DEFAULT",
        "copilot: DEFAULT",
    ])(
        "rejects implicit/default route %s before consulting configuration",
        (endpoint) => {
            expect(() =>
                getConfiguredRunbookModelOptions({
                    TYPEAGENT_RUNBOOK_MODEL_ENDPOINT: endpoint,
                    TYPEAGENT_RUNBOOK_MULTIMODAL: "true",
                }),
            ).toThrow("provider:named-model");
            expect(hasEndpoint).not.toHaveBeenCalled();
        },
    );

    test("rejects malformed declarations rather than silently enabling images", () => {
        expect(() =>
            getConfiguredRunbookModelOptions({
                TYPEAGENT_RUNBOOK_MULTIMODAL: "yes",
            }),
        ).toThrow("must be true or false");
    });

    test.each(["true", "false"])(
        "shared owned-service factory forwards declaration %s without eager model calls",
        (declaration) => {
            process.env.TYPEAGENT_RUNBOOK_MODEL_ENDPOINT =
                "azure:VERIFIED_VISION";
            process.env.TYPEAGENT_RUNBOOK_MULTIMODAL = declaration;
            const validator = async () => [];
            createDurableMemoryService("standalone-memory", validator);
            createDurableMemoryService("in-process-memory", validator);
            expect(constructors).toHaveLength(2);
            for (const { options } of constructors) {
                expect(options.runbookModelEndpoint).toBe(
                    "azure:VERIFIED_VISION",
                );
                expect(options.runbookMultimodal).toBe(declaration === "true");
                expect(options.runbookBindingValidator).toBe(validator);
            }
            expect(createChatModel).not.toHaveBeenCalled();
        },
    );
});
