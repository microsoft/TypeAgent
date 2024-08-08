// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { getCacheFactory } from "../src/utils/cacheFactory.js";
import { readTestData } from "../src/utils/test/testData.js";
import { Actions, RequestAction } from "agent-cache";
import { loadTranslatorSchemaConfig } from "../src/utils/loadSchemaConfig.js";
import { glob } from "glob";

const dataFiles = ["test/data/**/v5/*.json"];

const inputs = await Promise.all(
    (await glob(dataFiles)).map((f) => readTestData(f)),
);

const testInput = inputs.flatMap((f) =>
    f.entries.map<[string, string, RequestAction, object, string[]]>((data) => [
        f.translatorName,
        f.explainerName,
        new RequestAction(data.request, Actions.fromJSON(data.action)),
        data.explanation,
        data.tags ?? [],
    ]),
);

describe("construction", () => {
    describe("roundtrip", () => {
        it.each(testInput)(
            "[%s %s] '%s'",
            async (
                translatorName,
                explainerName,
                requestAction,
                explanation,
                tags,
            ) => {
                const explainer = getCacheFactory().getExplainer(
                    translatorName,
                    explainerName,
                );

                const construction = explainer.createConstruction!(
                    requestAction,
                    explanation,
                    {
                        getSchemaConfig: loadTranslatorSchemaConfig,
                    },
                );
                const matched = construction.match(requestAction.request);

                // Able to match roundtrip
                expect(matched.length).not.toEqual(0);

                if (!tags.includes("failedRoundTripAction")) {
                    expect(matched[0].match).toEqual(requestAction);
                } else {
                    // TODO: needs fix these
                    expect(matched[0].match).not.toEqual(requestAction);
                }

                const matchedLowercase = construction.match(
                    requestAction.request.toLowerCase(),
                );

                // Able to match roundtrip
                expect(matchedLowercase.length).not.toEqual(0);

                // TODO: Validating the lower case action
            },
        );
    });
});
