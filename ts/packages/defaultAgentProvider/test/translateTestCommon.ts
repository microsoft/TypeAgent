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

type TranslateTestStep = {
    request: string;
    action: string | string[] | FullAction | FullAction[];
    match?: "exact" | "partial"; // default to "exact"
    // History insertion after translation (if any)
    history?: ChatHistoryInput | ChatHistoryInput[];
    attachments?: string[] | undefined;
};
type TranslateTestEntry = TranslateTestStep | TranslateTestStep[];
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

    const inputsWithName = inputs.map(
        (i) =>
            [
                Array.isArray(i)
                    ? i.map((i) => i.request).join("|")
                    : i.request,
                i,
            ] as const,
    );
    describe(`${name} action stability`, () => {
        let dispatchers: Dispatcher[];
        beforeAll(async () => {
            const dispatcherP: Promise<Dispatcher>[] = [];
            for (let i = 0; i < repeat; i++) {
                dispatcherP.push(
                    createDispatcher("cli test translate", {
                        appAgentProviders: defaultAppAgentProviders,
                        agents: {
                            actions: false,
                            commands: ["dispatcher"],
                        },
                        execution: { history: false }, // don't generate chat history, the test manually imports them
                        explainer: { enabled: false },
                        cache: { enabled: false },
                        collectCommandResult: true,
                    }),
                );
            }
            dispatchers = await Promise.all(dispatcherP);
        });
        beforeEach(async () => {
            await Promise.all(
                dispatchers.map(async (dispatcher) => {
                    const result =
                        await dispatcher.processCommand("@history clear");
                    expect(result?.hasError).toBeFalsy();
                }),
            );
        });
        it.each(inputsWithName)(`${name} %p`, async (_, test) => {
            const steps = Array.isArray(test) ? test : [test];
            await Promise.all(
                dispatchers.map(async (dispatcher) => {
                    for (const step of steps) {
                        const { request, action, match, history, attachments } =
                            step;

                        const result = await dispatcher.processCommand(
                            request,
                            undefined,
                            attachments,
                        );
                        expect(result?.hasError).toBeFalsy();

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

                        if (history !== undefined) {
                            const insertResult =
                                await dispatcher.processCommand(
                                    `@history insert ${JSON.stringify({ user: request, assistant: history })}`,
                                );
                            expect(insertResult?.hasError).toBeFalsy();
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
