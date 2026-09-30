// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ActionPolicy } from "@typeagent/agent-sdk";
import type { TextEmbeddingModel } from "@typeagent/aiclient";
import { parseActionSchemaSource } from "@typeagent/action-schema";
import { convertToActionConfig } from "../src/translation/actionConfig.js";
import type { ActionSchemaFile } from "../src/translation/actionConfigProvider.js";
import { ActionSchemaSemanticMap } from "../src/translation/actionSchemaSemanticMap.js";
import { createActionContract } from "../src/structuredAction/contract.js";

function embeddingModel(
    getEmbedding: (text: string) => number[],
): TextEmbeddingModel {
    return {
        maxBatchSize: 1,
        async generateEmbedding(text) {
            return { success: true, data: getEmbedding(text) };
        },
    };
}

function schemaFixture(
    source: string,
    policies?: Record<string, ActionPolicy>,
) {
    const schemaName = "test.widgets";
    const configs = convertToActionConfig("test", {
        description: "Test agent",
        emojiChar: "",
        subActionManifests: {
            widgets: {
                schema: {
                    description: "Widgets",
                    schemaType: "Actions",
                    schemaFile: { format: "ts", content: source },
                    ...(policies === undefined
                        ? {}
                        : { actionPolicies: policies }),
                },
            },
        },
    });
    const config = configs[schemaName];
    const actionSchemaFile: ActionSchemaFile = {
        schemaName,
        sourceHash: source,
        parsedActionSchema: parseActionSchemaSource(
            source,
            schemaName,
            "Actions",
        ),
    };
    return { config, actionSchemaFile };
}

describe("ActionSchemaSemanticMap", () => {
    it("preserves the action map key and contract semantics for fresh and cached embeddings", async () => {
        const source = `
export type Actions = CreateWidgetType;
// Create a widget.
export type CreateWidgetType = {
    actionName: "createWidget";
    parameters: { name: string };
};
`;
        const policy = {
            effects: "state-changing",
            confirmation: "required",
        } as const;
        const { config, actionSchemaFile } = schemaFixture(source, {
            createWidget: policy,
        });
        const model = embeddingModel(() => [1, 0]);
        const freshMap = new ActionSchemaSemanticMap(model);
        await freshMap.addActionSchemaFile(config, actionSchemaFile);

        const fresh = await freshMap.rankActionCandidates(
            "create",
            1,
            () => true,
        );
        expect(fresh).toHaveLength(1);
        expect(fresh?.[0].actionName).toBe("createWidget");
        expect(fresh?.[0].definition.name).toBe("CreateWidgetType");

        let cachedModelCalls = 0;
        const cachedMap = new ActionSchemaSemanticMap(
            embeddingModel(() => {
                cachedModelCalls++;
                return [1, 0];
            }),
        );
        await cachedMap.addActionSchemaFile(
            config,
            actionSchemaFile,
            new Map(freshMap.embeddings()),
        );
        const cached = await cachedMap.rankActionCandidates(
            "create",
            1,
            () => true,
        );

        expect(cachedModelCalls).toBe(1);
        expect(cached?.[0].actionName).toBe("createWidget");
        expect(cached?.[0].definition.name).toBe("CreateWidgetType");

        const freshContract = createActionContract(
            {
                schemaName: fresh![0].schemaName,
                actionName: fresh![0].actionName,
            },
            fresh![0].definition,
            config,
        );
        const cachedContract = createActionContract(
            {
                schemaName: cached![0].schemaName,
                actionName: cached![0].actionName,
            },
            cached![0].definition,
            config,
        );
        expect(cachedContract).toMatchObject({
            schemaName: "test.widgets",
            actionName: "createWidget",
            policy: freshContract.policy,
            input: freshContract.input,
        });
    });

    it("returns undefined when semantic ranking is unavailable", async () => {
        const map = new ActionSchemaSemanticMap(null);
        await expect(
            map.rankActionCandidates("anything", 5, () => true),
        ).resolves.toBeUndefined();
    });

    it("orders by score, keeps identity ties stable, and filters before slicing", async () => {
        const source = `
export type Actions = TopType | BetaType | AlphaType | LowType;
// top
export type TopType = { actionName: "zeta" };
// tie
export type BetaType = { actionName: "beta" };
// tie
export type AlphaType = { actionName: "alpha" };
// low
export type LowType = { actionName: "low" };
`;
        const { config, actionSchemaFile } = schemaFixture(source);
        const map = new ActionSchemaSemanticMap(
            embeddingModel((text) => {
                if (text === "query" || text.includes(" top")) {
                    return [1, 0];
                }
                if (text.includes(" tie")) {
                    return [0.8, 0.6];
                }
                return [0, 1];
            }),
        );
        await map.addActionSchemaFile(config, actionSchemaFile);

        const ranked = await map.rankActionCandidates("query", 3, () => true);
        expect(ranked?.map(({ actionName }) => actionName)).toEqual([
            "zeta",
            "alpha",
            "beta",
        ]);

        const filtered = await map.rankActionCandidates(
            "query",
            2,
            (_schemaName, actionName) => actionName !== "zeta",
        );
        expect(filtered?.map(({ actionName }) => actionName)).toEqual([
            "alpha",
            "beta",
        ]);
    });

    it("keeps the complete old schema until the latest replacement is ready", async () => {
        const oldFixture = schemaFixture(`
export type Actions = OldType;
// old
export type OldType = { actionName: "oldAction" };
`);
        const firstFixture = schemaFixture(`
export type Actions = FirstType;
// first
export type FirstType = { actionName: "firstAction" };
`);
        const secondFixture = schemaFixture(`
export type Actions = SecondType;
// second
export type SecondType = { actionName: "secondAction" };
`);
        let resolveFirst!: (value: { success: true; data: number[] }) => void;
        let resolveSecond!: (value: { success: true; data: number[] }) => void;
        const firstEmbedding = new Promise<{
            success: true;
            data: number[];
        }>((resolve) => {
            resolveFirst = resolve;
        });
        const secondEmbedding = new Promise<{
            success: true;
            data: number[];
        }>((resolve) => {
            resolveSecond = resolve;
        });
        const model: TextEmbeddingModel = {
            maxBatchSize: 1,
            generateEmbedding(text) {
                if (text.includes("firstAction")) {
                    return firstEmbedding;
                }
                if (text.includes("secondAction")) {
                    return secondEmbedding;
                }
                return Promise.resolve({ success: true, data: [1, 0] });
            },
        };
        const map = new ActionSchemaSemanticMap(model);
        await map.addActionSchemaFile(
            oldFixture.config,
            oldFixture.actionSchemaFile,
        );
        const firstReplacement = map.replaceActionSchemaFile(
            firstFixture.config,
            firstFixture.actionSchemaFile,
        );
        const secondReplacement = map.replaceActionSchemaFile(
            secondFixture.config,
            secondFixture.actionSchemaFile,
        );
        const beforeReplacement = await map.rankActionCandidates(
            "query",
            5,
            () => true,
        );
        expect(beforeReplacement?.map(({ actionName }) => actionName)).toEqual([
            "oldAction",
        ]);

        resolveSecond({ success: true, data: [1, 0] });
        await secondReplacement;
        const afterSecond = await map.rankActionCandidates(
            "query",
            5,
            () => true,
        );
        expect(afterSecond?.map(({ actionName }) => actionName)).toEqual([
            "secondAction",
        ]);

        resolveFirst({ success: true, data: [1, 0] });
        await firstReplacement;
        const afterFirst = await map.rankActionCandidates(
            "query",
            5,
            () => true,
        );
        expect(afterFirst?.map(({ actionName }) => actionName)).toEqual([
            "secondAction",
        ]);
    });
});
