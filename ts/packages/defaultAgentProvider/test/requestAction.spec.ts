// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { readExplanationTestData } from "agent-dispatcher/internal";
import { RequestAction, fromJsonActions } from "agent-cache";
import { glob } from "glob";

const dataFiles = ["test/data/explanations/**/**/*.json"];

const inputs = await Promise.all(
    (await glob(dataFiles)).map((f) =>
        readExplanationTestData(getPackageFilePath(f)),
    ),
);

const testInput = inputs.flatMap((f) =>
    f.entries.map(
        (data) => new RequestAction(data.request, fromJsonActions(data.action)),
    ),
);

describe("RequestAction toString <=> fromString", () => {
    it.each(testInput)("%s", (requestAction) => {
        const str = requestAction.toString();
        const newRequestAction = RequestAction.fromString(str);
        expect(requestAction).toMatchObject(newRequestAction);
        expect(newRequestAction.toString()).toBe(str);
    });
});
