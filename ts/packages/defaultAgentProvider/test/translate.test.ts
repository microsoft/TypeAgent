// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import fs from "node:fs";
import { createDispatcher, Dispatcher } from "agent-dispatcher";

const dataFiles = ["test/data/translate-e2e.json"];

type TranslateTestRequest = {
    request: string;
    action: string | string[];
};
type TranslateTestEntry = TranslateTestRequest | TranslateTestRequest[];
type TranslateTestFile = TranslateTestEntry[];

const inputs: TranslateTestEntry[] = (
    await Promise.all(
        dataFiles.map<Promise<TranslateTestFile>>(async (f) => {
            return JSON.parse(
                await fs.promises.readFile(getPackageFilePath(f), "utf-8"),
            );
        }),
    )
).flat();

const repeat = 5;
const defaultAppAgentProviders = getDefaultAppAgentProviders(undefined);

describe("translation action stability", () => {
    let dispatchers: Dispatcher[];
    beforeAll(async () => {
        const dispatcherP: Promise<Dispatcher>[] = [];
        for (let i = 0; i < repeat; i++) {
            dispatcherP.push(
                createDispatcher("cli test translate", {
                    appAgentProviders: defaultAppAgentProviders,
                    actions: null,
                    commands: { dispatcher: true },
                    translation: { history: { enabled: false } },
                    explainer: { enabled: false },
                    cache: { enabled: false },
                }),
            );
        }
        dispatchers = await Promise.all(dispatcherP);
    });
    it.each(inputs)("translate '$request'", async (test) => {
        const requests = Array.isArray(test) ? test : [test];
        await Promise.all(
            dispatchers.map(async (dispatcher) => {
                for (const { request, action } of requests) {
                    const result = await dispatcher.processCommand(request);
                    expect(result?.actions).toBeDefined();

                    const expected =
                        typeof action === "string" ? [action] : action;
                    expect(result?.actions).toHaveLength(expected.length);
                    for (let i = 0; i < expected.length; i++) {
                        expect(
                            `${result?.actions?.[i].translatorName}.${result?.actions?.[i].actionName}`,
                        ).toBe(expected[i]);
                    }
                }
            }),
        );
    });
    afterAll(async () => {
        await Promise.all(dispatchers.map((d) => d.close()));
        dispatchers = [];
    });
});
