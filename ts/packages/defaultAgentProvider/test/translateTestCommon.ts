// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import fs from "node:fs";
import { createDispatcher, Dispatcher } from "agent-dispatcher";
import { ChatHistoryInput } from "agent-dispatcher/internal";
import { FullAction } from "agent-cache";

type TranslateTestRequest = {
    request: string;
    action: string | string[] | FullAction | FullAction[];
    history?: ChatHistoryInput | ChatHistoryInput[];
    match?: "exact" | "partial"; // default to "exact"
};
type TranslateTestEntry = TranslateTestRequest | TranslateTestRequest[];
type TranslateTestFile = TranslateTestEntry[];
const repeat = 5;
const defaultAppAgentProviders = getDefaultAppAgentProviders(undefined);

export async function defineTranslateTest(name: string, dataFiles: string[]) {
    const inputs: TranslateTestEntry[] = (
        await Promise.all(
            dataFiles.map<Promise<TranslateTestFile>>(async (f) => {
                return JSON.parse(
                    await fs.promises.readFile(getPackageFilePath(f), "utf-8"),
                );
            }),
        )
    ).flat();

    describe(`${name} action stability`, () => {
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
        it.each(inputs)(`${name} '$request'`, async (test) => {
            const requests = Array.isArray(test) ? test : [test];
            await Promise.all(
                dispatchers.map(async (dispatcher) => {
                    for (const {
                        request,
                        history,
                        action,
                        match,
                    } of requests) {
                        if (history !== undefined) {
                            await dispatcher.processCommand(
                                `@history insert ${JSON.stringify(history)}`,
                            );
                        }
                        const result = await dispatcher.processCommand(request);
                        const actions = result?.actions;
                        expect(actions).toBeDefined();

                        const expectedValues = Array.isArray(action)
                            ? action
                            : [action];
                        expect(actions).toHaveLength(expectedValues.length);
                        for (let i = 0; i < expectedValues.length; i++) {
                            const action = actions![i];
                            const expected = expectedValues[i];
                            if (typeof expected === "string") {
                                const actualFullActionName = `${action.translatorName}.${action.actionName}`;
                                if (match === "partial") {
                                    expect(actualFullActionName).toContain(
                                        expected,
                                    );
                                } else {
                                    expect(actualFullActionName).toBe(expected);
                                }
                            } else {
                                if (match === "partial") {
                                    expect(action).toMatchObject(expected);
                                } else {
                                    expect(action).toEqual(expected);
                                }
                            }
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
}
