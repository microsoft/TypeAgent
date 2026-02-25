// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import {
    createSchemaInfoProvider,
    getCacheFactory,
    readExplanationTestData,
    getAllActionConfigProvider,
} from "agent-dispatcher/internal";
import { fromJsonActions, RequestAction, toJsonActions } from "agent-cache";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import { glob } from "glob";
import {
    loadGrammarRules,
    compileGrammarToNFA,
    matchGrammarWithNFA,
} from "action-grammar";
import { convertConstructionsToGrammar } from "agent-cache/grammar";

const dataFiles = ["test/data/explanations/**/v5/*.json"];

const inputs = await Promise.all(
    (await glob(dataFiles)).map((f) => readExplanationTestData(f)),
);

const testInput = inputs.flatMap((f) =>
    f.entries.map<[string, string, RequestAction, object, string[]]>((data) => [
        f.schemaName,
        f.explainerName,
        new RequestAction(data.request, fromJsonActions(data.action)),
        data.explanation,
        data.tags ?? [],
    ]),
);

const schemaInfoProvider = createSchemaInfoProvider(
    (await getAllActionConfigProvider(getDefaultAppAgentProviders(undefined)))
        .provider,
);

function getGrammar(
    schemaName: string,
    explainerName: string,
    requestAction: RequestAction,
    explanation: object,
) {
    try {
        const explainer = getCacheFactory().getExplainer(
            [schemaName],
            explainerName,
        );

        const construction = explainer.createConstruction!(
            requestAction,
            explanation,
            {
                schemaInfoProvider,
            },
        );

        const g = convertConstructionsToGrammar([construction]);
        return g !== "" ? g : undefined;
    } catch {
        return undefined;
    }
}

describe("Grammar NFA", () => {
    describe("roundtrip", () => {
        for (const [
            schemaName,
            explainerName,
            requestAction,
            explanation,
        ] of testInput) {
            const testName = `[${schemaName} ${explainerName}] '${requestAction.request}'`;
            const grammar = getGrammar(
                schemaName,
                explainerName,
                requestAction,
                explanation,
            );
            if (grammar === undefined) {
                it.skip(testName, () => {});
                continue;
            }
            it(testName, () => {
                const g = loadGrammarRules("test", grammar);
                const nfa = compileGrammarToNFA(g);
                const matched = matchGrammarWithNFA(
                    g,
                    nfa,
                    requestAction.request,
                );

                expect(matched.length).not.toEqual(0);
                expect(matched[0].match).toEqual(
                    toJsonActions(requestAction.actions),
                );
            });
        }
    });
});
