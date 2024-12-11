// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { Actions, RequestAction } from "agent-cache";
import { readTestData } from "../src/utils/test/testData.js";
import { getCacheFactory } from "../src/utils/cacheFactory.js";
import { glob } from "glob";

const dataFiles = ["test/data/**/**/*.json"];

const inputs = await Promise.all(
    (await glob(dataFiles)).map((f) => readTestData(getPackageFilePath(f))),
);

const testInput = inputs.flatMap((f) =>
    f.entries.map<[string, string, RequestAction, any]>((data) => [
        f.schemaName,
        f.explainerName,
        new RequestAction(data.request, Actions.fromJSON(data.action)),
        data.explanation,
    ]),
);

describe("Validate Explanation Test Data", () => {
    it.each(testInput)(
        "[%s %s] '%s'",
        async (schemaName, explainerName, requestAction, explanation) => {
            const explainer = getCacheFactory().getExplainer(
                [schemaName],
                explainerName,
            );
            expect(explainer.validate).not.toBeUndefined();
            expect(
                explainer.validate!(requestAction, explanation),
            ).toBeUndefined();
        },
    );
});
