// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import { CommandResult, createDispatcher, Dispatcher } from "agent-dispatcher";
import { ChatHistoryInputAssistant } from "agent-dispatcher/internal";
import { FullAction } from "agent-cache";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InstanceConfigProvider } from "../src/utils/config.js";

type ActionMatch = string | string[] | FullAction | FullAction[];
export type TranslateTestStep = {
    // Input
    request: string;
    attachments?: string[] | undefined;

    // Output
    // If not specified, translation is not checked, only whether validate whether it can be translated.
    action?:
        | ActionMatch
        | {
              anyof: ActionMatch[];
          }
        | undefined;
    match?: "exact" | "partial"; // default to "exact"

    // Execution result:
    // History insertion after translation (if any)
    history?: ChatHistoryInputAssistant | ChatHistoryInputAssistant[];
};

export type TranslateTestEntry = TranslateTestStep | TranslateTestStep[];
export type TranslateTestFile = TranslateTestEntry[];

const repeat = 5;
const concurrency = 5;
const embeddingCacheDir = path.join(os.tmpdir(), ".typeagent", "cache");
export async function defineTranslateTest(
    name: string,
    dataFiles: string[],
    instanceConfigProvider?: InstanceConfigProvider,
) {
    const defaultAppAgentProviders = getDefaultAppAgentProviders(
        instanceConfigProvider,
    );
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
        let dispatchers: Dispatcher[] = [];
        let dispatcherP: Promise<void> | undefined;
        let dispatcherDone: (() => void) | undefined;
        async function acquireDispatcher() {
            while (dispatchers.length === 0) {
                if (dispatcherP === undefined) {
                    dispatcherP = new Promise<void>((resolve) => {
                        dispatcherDone = resolve;
                    });
                }
                await dispatcherP;
            }
            return dispatchers.pop()!;
        }
        function releaseDispatcher(d: Dispatcher) {
            dispatchers.push(d);
            const done = dispatcherDone;
            dispatcherDone = undefined;
            dispatcherP = undefined;
            done?.();
        }
        async function runOnDispatcher(
            fn: (dispatcher: Dispatcher) => Promise<void>,
        ) {
            const d = await acquireDispatcher();
            try {
                await fn(d);
            } finally {
                releaseDispatcher(d);
            }
        }

        async function runOnDispatchers(
            fn: (dispatcher: Dispatcher) => Promise<void>,
        ) {
            const p: Promise<void>[] = [];
            for (let i = 0; i < repeat; i++) {
                p.push(runOnDispatcher(fn));
            }
            // Make sure all promise finished before checking the result
            await Promise.allSettled(p);
            // Propagate any errors
            return Promise.all(p);
        }
        beforeAll(async () => {
            for (let i = 0; i < Math.min(concurrency, repeat); i++) {
                dispatchers.push(
                    await createDispatcher("cli test translate", {
                        appAgentProviders: defaultAppAgentProviders,
                        agents: {
                            actions: false,
                            commands: ["dispatcher"],
                        },
                        execution: { history: false }, // don't generate chat history, the test manually imports them
                        explainer: { enabled: false },
                        cache: { enabled: false },
                        embeddingCacheDir, // Cache the embedding to avoid recomputation.
                        collectCommandResult: true,
                    }),
                );
            }
        });
        describe.each(inputsWithName)(`${name} %p`, (_, test) => {
            const steps = Array.isArray(test) ? test : [test];
            it.each(steps)(
                "step $#: $request",
                async (step) => {
                    await runOnDispatchers(async (dispatcher) => {
                        await setupOneStep(steps, step, dispatcher);
                        const result = await runOneStep(step, dispatcher);
                        validateCommandResult(step, result);
                    });
                },
                6000 * repeat,
            );
        });
        afterAll(async () => {
            const p = dispatchers.map((d) => d.close());
            await Promise.allSettled(p);
            dispatchers = [];
            await Promise.all(p);
        });
    });
}

async function setupOneStep(
    steps: TranslateTestStep[],
    curr: TranslateTestStep,
    dispatcher: Dispatcher,
) {
    const result = await dispatcher.processCommand("@history clear");
    if (result?.hasError === true) {
        throw new Error(`Failed to clear history: ${result.exception}`);
    }
    for (const step of steps) {
        if (step === curr) {
            return;
        }
        const { request, history } = step;

        if (history !== undefined) {
            const insertResult = await dispatcher.processCommand(
                `@history insert ${JSON.stringify({ user: request, assistant: history })}`,
            );
            if (insertResult?.hasError === true) {
                throw new Error(
                    `Failed to insert history: ${insertResult.exception}`,
                );
            }
        }
    }

    throw new Error(`Test step not found: ${curr.request}`);
}

async function runOneStep(step: TranslateTestStep, dispatcher: Dispatcher) {
    const { request, attachments } = step;

    return await dispatcher.processCommand(request, undefined, attachments);
}

function validateCommandResult(
    step: TranslateTestStep,
    result?: CommandResult,
) {
    const { request, action, match } = step;
    if (result?.hasError) {
        throw new Error(`Request '${request}' failed: ${result.exception}`);
    }

    if (action !== undefined) {
        const actions = result?.actions;
        expect(actions).toBeDefined();

        if (
            !Array.isArray(action) &&
            typeof action === "object" &&
            "anyof" in action
        ) {
            for (const expected of action.anyof) {
                try {
                    validateExpectedActions(expected, actions!, match);
                    return;
                } catch {}
            }
            throw new Error(
                `None of the expected actions matched:\n  received:${JSON.stringify(actions!)}\n. expected:${JSON.stringify(
                    action.anyof,
                )}`,
            );
        } else {
            validateExpectedActions(action, actions!, match);
        }
    }
}

function validateExpectedActions(
    expected: ActionMatch,
    actions: FullAction[],
    match?: "exact" | "partial",
) {
    const expectedValues = Array.isArray(expected) ? expected : [expected];
    expect(actions).toHaveLength(expectedValues.length);

    for (let i = 0; i < expectedValues.length; i++) {
        const action = actions![i];
        const expected = expectedValues[i];
        if (typeof expected === "string") {
            const actualFullActionName = `${action.schemaName}.${action.actionName}`;
            if (match === "partial") {
                expect(actualFullActionName).toContain(expected);
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
