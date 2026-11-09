// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import type { AgentSchemaInfo } from "@typeagent/dispatcher-types";
import {
    getChatModelTelemetryContext,
    withChatModelTelemetryContext,
    type ChatModelTelemetryContext,
} from "@typeagent/aiclient";
import type { KeywordExtractionInput } from "../src/context/contextSelector/keywordExtractor.js";
import type { CreateChatModel } from "../src/context/contextSelector/keywordDistiller.js";

const observed: ChatModelTelemetryContext[] = [];

const typechatUtils = await import("@typeagent/typechat-utils");
jest.unstable_mockModule("@typeagent/typechat-utils", () => ({
    ...typechatUtils,
    createJsonTranslatorFromSchemaDef: () => ({
        translate: async () => {
            observed.push(getChatModelTelemetryContext());
            return { success: true, data: { summary: "", explanation: "" } };
        },
    }),
}));

const { polishAgentView } = await import(
    "../src/context/system/describe/describeCore.js"
);
const { distillKeywords } = await import(
    "../src/context/contextSelector/keywordDistiller.js"
);

function makeAgent(): AgentSchemaInfo {
    return {
        name: "spotify",
        emoji: "music",
        description: "controls your local Spotify instance",
        subSchemas: [
            {
                schemaName: "spotify",
                description: "Spotify playback control",
                schemaText: undefined,
                actions: [{ name: "play", description: "Play a track" }],
            },
        ],
    };
}

const keywordInput: KeywordExtractionInput = {
    actionName: "addItems",
    actionComments: ["Add items to a list"],
    paramNames: ["items"],
    paramComments: ["the items to add"],
    schemaDescription: "manages lists",
};

const keywordModel: CreateChatModel = () =>
    ({
        completionSettings: {},
        complete: async () => {
            observed.push(getChatModelTelemetryContext());
            return {
                success: true,
                data: JSON.stringify({ keywords: ["list", "item"] }),
            };
        },
    }) as ReturnType<CreateChatModel>;

describe("dispatcher LLM classification call sites", () => {
    beforeEach(() => {
        observed.length = 0;
    });

    it("classifies capability description and inherits the caller's phase", async () => {
        await polishAgentView(makeAgent(), "deterministic");

        expect(observed).toEqual([
            {
                phase: "unknown",
                purpose: "capability-description",
                scope: "foreground",
                classificationSource: "explicit",
            },
        ]);

        observed.length = 0;
        await withChatModelTelemetryContext(
            { phase: "action", purpose: "action", scope: "foreground" },
            () => polishAgentView(makeAgent(), "deterministic"),
        );
        expect(observed).toEqual([
            {
                phase: "action",
                purpose: "capability-description",
                scope: "foreground",
                classificationSource: "explicit",
            },
        ]);
    });

    it("classifies keyword authoring as explicit background work", async () => {
        await distillKeywords(keywordInput, { createModel: keywordModel });

        expect(observed).toEqual([
            {
                phase: "background",
                purpose: "keyword-authoring",
                scope: "background",
                classificationSource: "explicit",
            },
        ]);
    });

    it("keeps keyword authoring background under a foreground caller", async () => {
        await withChatModelTelemetryContext(
            { phase: "action", purpose: "action", scope: "foreground" },
            () => distillKeywords(keywordInput, { createModel: keywordModel }),
        );

        expect(observed[0]).toEqual({
            phase: "background",
            purpose: "keyword-authoring",
            scope: "background",
            classificationSource: "explicit",
        });
    });
});
