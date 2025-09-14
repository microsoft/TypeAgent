// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import dotenv from "dotenv";
dotenv.config({ path: new URL("../../../../.env", import.meta.url) });

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import { CommandResult, createDispatcher, Dispatcher } from "agent-dispatcher";
import { ChatHistoryInputAssistant } from "agent-dispatcher/internal";
import {
    FullAction,
    normalizeParamValue,
    ParamValueType,
    splitFullActionName,
} from "agent-cache";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InstanceConfigProvider } from "../src/utils/config.js";
import { setObjectProperty } from "common-utils";
import chalk from "chalk";
import { normalizeAction } from "./constructionCacheTestCommon.js";

type SimpleActionMatch = string | FullAction;

type ActionMatchWithAlternates = {
    action: FullAction;
    partial?: boolean;
    alternates?: Record<string, ParamValueType | ParamValueType[]>;
};

type OneActionMatch = SimpleActionMatch | ActionMatchWithAlternates;
type AnyOfActionMatch = {
    anyof: OneActionMatch[];
};

type ActionMatch = SimpleActionMatch | AnyOfActionMatch;

function isActionMatchWithAlternates(
    a: OneActionMatch,
): a is ActionMatchWithAlternates {
    return typeof a === "object" && "action" in a;
}

function isAnyOfActionMatch(a: ActionMatch): a is AnyOfActionMatch {
    return typeof a === "object" && "anyof" in a;
}

function toActionMatchWithAlternates(
    match: OneActionMatch,
): ActionMatchWithAlternates {
    return isActionMatchWithAlternates(match)
        ? match
        : typeof match === "string"
          ? { action: splitFullActionName(match), partial: true }
          : { action: match };
}
function normalizeActionMatches(
    match: ActionMatch | ActionMatch[],
): ActionMatchWithAlternates[][] {
    const actionMatches = Array.isArray(match) ? match : [match];
    return actionMatches.map((m) =>
        isAnyOfActionMatch(m)
            ? m.anyof.map(toActionMatchWithAlternates)
            : [toActionMatchWithAlternates(m)],
    );
}

export type TranslateTestStep = {
    // Input
    request: string;
    attachments?: string[] | undefined;

    // Output
    // If not specified, translation is not checked, only whether validate whether it can be translated.
    expected?: ActionMatch | ActionMatch[] | undefined;

    // Execution result:
    // History insertion after translation (if any)
    history?: ChatHistoryInputAssistant | ChatHistoryInputAssistant[];
};

export type TranslateTestEntry = TranslateTestStep | TranslateTestStep[];
export type TranslateTestFile = TranslateTestEntry[];

const repeat = 5;
const concurrency = 1;
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
    const { request, expected } = step;
    if (result?.hasError) {
        throw new Error(`Request '${request}' failed: ${result.exception}`);
    }

    if (expected !== undefined) {
        const actionMatches = normalizeActionMatches(expected);
        const actions = result?.actions!;
        if (actions === undefined) {
            throw new Error(
                `Request '${request}' did not return any actions, expected ${JSON.stringify(expected)}`,
            );
        }
        expect(actions).toHaveLength(actionMatches.length);

        for (let i = 0; i < actionMatches.length; i++) {
            const actionMatch = actionMatches[i];
            const action = actions[i];
            validateExpectedAction(actionMatch, action);
        }
    }
}

type PossibleMatch = {
    action: FullAction;
    partial: boolean;
};

function expandAlternates(
    expectedMatch: ActionMatchWithAlternates,
): { action: FullAction; partial: boolean }[] {
    const expandedActions = [
        {
            action: structuredClone(expectedMatch.action),
            partial: expectedMatch.partial === true,
        },
    ];
    normalizeAction(expandedActions[0].action);
    if (expectedMatch.alternates !== undefined) {
        for (const [name, v] of Object.entries(expectedMatch.alternates)) {
            const values = Array.isArray(v) ? v : [v];
            expandedActions.push(
                ...values.flatMap((v) =>
                    expandedActions.map((a) => {
                        const n = structuredClone(a);
                        setObjectProperty(
                            n.action,
                            "parameters",
                            name,
                            normalizeParamValue(v),
                        );
                        return n;
                    }),
                ),
            );
        }
    }
    return expandedActions;
}

function checkPossibleMatch(action: FullAction, possibleMatch: PossibleMatch) {
    if (possibleMatch.partial) {
        expect(action).toMatchObject(possibleMatch.action);
    } else {
        expect(action).toEqual(possibleMatch.action);
    }
}

function validateExpectedAction(
    match: ActionMatchWithAlternates[],
    action: FullAction,
) {
    const filtered = match.filter(
        (em) =>
            em.action.schemaName === action.schemaName &&
            em.action.actionName === action.actionName,
    );
    if (filtered.length === 0) {
        throw new Error(
            [
                "Action does not match any of the expected actions",
                ,
                chalk.red(
                    `Received: ${action.schemaName}.${action.actionName}`,
                ),
                chalk.green(
                    `Expected: ${JSON.stringify(
                        match.map(
                            (e) =>
                                `${e.action.schemaName}.${e.action.actionName}`,
                        ),
                        null,
                        2,
                    )}`,
                ),
            ].join("\n"),
        );
    }

    const possibleMatches = filtered.flatMap(expandAlternates);
    const normalizedAction = structuredClone(action);
    normalizeAction(normalizedAction);
    if (possibleMatches.length === 1) {
        checkPossibleMatch(normalizedAction, possibleMatches[0]);
        return;
    }

    const errors: string[] = [];
    for (const possibleMatch of possibleMatches) {
        try {
            checkPossibleMatch(normalizedAction, possibleMatch);
            return;
        } catch (e: any) {
            errors.push(e.message);
        }
    }

    throw new Error(
        [
            "Error: No matches found",
            ,
            chalk.green(`Expected: ${JSON.stringify(possibleMatches)}`),
            chalk.red(`Received: ${JSON.stringify(normalizedAction, null, 2)}`),
        ].join("\n"),
    );
}
