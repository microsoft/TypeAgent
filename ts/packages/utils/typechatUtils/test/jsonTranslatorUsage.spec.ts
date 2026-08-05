// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { error, success } from "typechat";

const jestObject = import.meta.jest;
const unstableMockModule = (
    jestObject as typeof jestObject & {
        unstable_mockModule: (
            moduleName: string,
            factory: () => unknown,
        ) => void;
    }
).unstable_mockModule;
const complete = jestObject
    .fn()
    .mockResolvedValueOnce(success('{"value":1}'))
    .mockResolvedValueOnce(success('{"value":"repaired"}'));

unstableMockModule("@typeagent/aiclient", () => ({
    AzureTokenScopes: { AzureMaps: "AzureMaps" },
    createAzureTokenProvider: () => async () => "token",
    getBlob: async () => error("not used"),
    getEnvSetting: () => undefined,
    openai: {
        apiSettingsFromEnv: () => ({}),
        createChatModel: () => ({
            complete,
            completionSettings: {},
        }),
        supportsStreaming: () => false,
    },
}));

const { createJsonTranslatorWithValidator } = await import(
    "../src/jsonTranslator.js"
);

describe("JSON translator usage accounting", () => {
    test("retains the request callback for TypeChat repair completions", async () => {
        const usageCallback = jestObject.fn();
        const translator = createJsonTranslatorWithValidator<{ value: string }>(
            "output",
            {
                getSchemaText: () => "export type Output = { value: string }",
                getTypeName: () => "Output",
                validate: (value: object) =>
                    typeof (value as { value?: unknown }).value === "string"
                        ? success(value as { value: string })
                        : error("value must be a string"),
            },
        );

        const result = await translator.translate(
            "request",
            undefined,
            undefined,
            usageCallback,
        );

        expect(result).toEqual(success({ value: "repaired" }));
        expect(complete).toHaveBeenCalledTimes(2);
        expect(complete.mock.calls[0][1]).toBe(usageCallback);
        expect(complete.mock.calls[1][1]).toBe(usageCallback);
    });
});
