// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { getCacheFactory } from "../src/utils/cacheFactory.js";
import { readTestData } from "../src/utils/test/testData.js";
import { Actions, RequestAction } from "agent-cache";
import { createSchemaInfoProviderFromDefaultAppAgentProviders } from "../src/utils/defaultAppProviders.js";
import { glob } from "glob";

const dataFiles = ["test/data/**/v5/*.json"];

const inputs = await Promise.all(
    (await glob(dataFiles)).map((f) => readTestData(f)),
);

const testInput = inputs.flatMap((f) =>
    f.entries.map<[string, string, RequestAction, object, string[]]>((data) => [
        f.schemaName,
        f.explainerName,
        new RequestAction(data.request, Actions.fromJSON(data.action)),
        data.explanation,
        data.tags ?? [],
    ]),
);

const matchConfig = {
    enableWildcard: false,
    rejectReferences: false,
};

describe("construction", () => {
    describe("roundtrip", () => {
        it.each(testInput)(
            "[%s %s] '%s'",
            async (
                schemaName,
                explainerName,
                requestAction,
                explanation,
                tags,
            ) => {
                const explainer = getCacheFactory().getExplainer(
                    [schemaName],
                    explainerName,
                );

                const construction = explainer.createConstruction!(
                    requestAction,
                    explanation,
                    {
                        schemaInfoProvider:
                            createSchemaInfoProviderFromDefaultAppAgentProviders(),
                    },
                );

                const matched = construction.match(
                    requestAction.request,
                    matchConfig,
                );

                // TODO: once MatchPart allow matches ignoring diacritical marks,
                // we can use normalizeParamString instead toLowerCase here.
                const matchedLowerCase = construction.match(
                    requestAction.request.toLowerCase(),
                    matchConfig,
                );
                if (!tags.includes("failedRoundTripAction")) {
                    // Able to match roundtrip
                    expect(matched.length).not.toEqual(0);
                    expect(matched[0].match).toEqual(requestAction);

                    expect(matchedLowerCase.length).not.toEqual(0);
                    // TODO: Validating the lower case action
                } else {
                    // TODO: needs fix these
                    if (matched.length !== 0) {
                        expect(matched[0].match).not.toEqual(requestAction);
                    }
                }
            },
        );
    });
});
