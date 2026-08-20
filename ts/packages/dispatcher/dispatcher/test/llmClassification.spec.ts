// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Proves that the dispatcher call sites that used to reach the model with no
// classification now report a concrete purpose and an `explicit`
// classification source. The assertions read the aiclient telemetry context
// from inside the model/translator stub, which is exactly what the central
// model wrapper reads when it records `llm:started` / `llm:completed`.

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
    // `describeCore` builds its translator through this factory; the stub
    // records what the central model wrapper would have seen.
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
        emoji: "🎵",
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
        complete: async () => {
            observed.push(getChatModelTelemetryContext());
            return {
                success: true,
                data: JSON.stringify({ keywords: ["list", "item"] }),
            };
        },
    }) as unknown as ReturnType<CreateChatModel>;

describe("dispatcher LLM classification call sites", () => {
    // No OTel span manager is installed: the classification rides on storage
    // the aiclient package owns, so it works in a logs-only process too.
    beforeEach(() => {
        observed.length = 0;
    });

    it("classifies capability description and inherits the caller's phase", async () => {
        await polishAgentView(makeAgent(), "deterministic");

        expect(observed).toEqual([
            {
                // `@describe` is a command, which is not one of the tracked
                // request phases, so the phase stays unknown - but the call is
                // explicitly classified, which is what the ratchet measures.
                phase: "unknown",
                purpose: "capability-description",
                scope: "foreground",
                classificationSource: "explicit",
            },
        ]);

        // Reached from the system.help actions instead, the enclosing action
        // phase is preserved and only the purpose is refined.
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

    it("keeps keyword authoring background even under a foreground caller", async () => {
        await withChatModelTelemetryContext(
            { phase: "action", purpose: "action", scope: "foreground" },
            () => distillKeywords(keywordInput, { createModel: keywordModel }),
        );

        expect(observed[0]).toMatchObject({
            phase: "background",
            scope: "background",
        });
    });
});
