// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { readTestData } from "../src/utils/test/testData.js";
import {
    getBuiltinTranslatorConfigProvider,
    loadAgentJsonTranslator,
} from "../src/translation/agentTranslators.js";
import { JSONAction } from "agent-cache";

const dataFiles = [
    "test/data/player/v5/simpleV1.json",
    "test/data/player/v5/fullV1.json",
    "test/data/calendar/v5/simpleV1.json",
    "test/data/calendar/v5/complexV1.json",
];

const inputs = await Promise.all(
    dataFiles.map((f) => readTestData(getPackageFilePath(f))),
);
const testInput = inputs.flatMap((f) =>
    f.entries.map<[string, string, JSONAction | JSONAction[]]>((data) => [
        f.translatorName,
        data.request,
        data.action,
    ]),
);

describe("translation", () => {
    it.each(testInput)(
        "translate [%s] '%s'",
        async (translatorName, request, action) => {
            const translator = loadAgentJsonTranslator(
                translatorName,
                getBuiltinTranslatorConfigProvider(),
            );
            const result = await translator.translate(request);
            expect(result.success).toBe(true);
            if (result.success) {
                // TODO: check if the action is the same to check if it is stable.
                // expect(result.data).toMatchObject(action);
            } else {
                console.log(
                    `Translation failed: ${request}\n${result.message}`,
                );
            }
        },
        30000,
    );
});
