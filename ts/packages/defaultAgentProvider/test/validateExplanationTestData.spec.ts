// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { fromJsonActions, RequestAction } from "agent-cache";
import {
    getCacheFactory,
    readExplanationTestData,
} from "agent-dispatcher/internal";
import { glob } from "glob";

const dataFiles = ["test/data/explanations/**/**/*.json"];

const inputs = await Promise.all(
    (await glob(dataFiles)).map((f) =>
        readExplanationTestData(getPackageFilePath(f)),
    ),
);

const testInput = inputs.flatMap((f) =>
    f.entries.map<[string, string, RequestAction, any]>((data) => [
        f.schemaName,
        f.explainerName,
        new RequestAction(data.request, fromJsonActions(data.action)),
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
