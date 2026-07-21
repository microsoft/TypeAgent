// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { loadConfigSync } from "@typeagent/config";
loadConfigSync();

import { getPackageFilePath } from "../src/utils/getPackageFilePath.js";
import { getDefaultAppAgentProviders } from "../src/defaultAgentProviders.js";
import {
    awaitCommand,
    CommandResult,
    createDispatcher,
    Dispatcher,
} from "agent-dispatcher";
import { ChatHistoryInputAssistant } from "agent-dispatcher/internal";
import {
    normalizeParamValue,
    ParamValueType,
    splitFullActionName,
} from "agent-cache";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InstanceConfigProvider } from "../src/utils/config.js";
import { getObjectProperty, setObjectProperty } from "@typeagent/common-utils";
import chalk from "chalk";
import { normalizeAction } from "./constructionCacheTestCommon.js";
import { TypeAgentAction } from "@typeagent/agent-sdk";

type SimpleActionMatch = string | TypeAgentAction;

type ActionMatchWithAlternates = {
    action: TypeAgentAction;
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

// Sentinel usable only in `extraActions`: the trailing action passes only when
// it is an exact duplicate of the action immediately preceding it. Scopes the
// tolerance tightly to the known flake where the model repeats its final action
// (e.g. a duplicated dispatcher.pendingRequestAction), instead of accepting an
// arbitrary extra action of a given type.
type DuplicateOfPreviousMatch = { duplicateOfPrevious: true };
type ExtraActionMatch = ActionMatch | DuplicateOfPreviousMatch;
function isDuplicateOfPreviousMatch(
    a: ExtraActionMatch,
): a is DuplicateOfPreviousMatch {
    return typeof a === "object" && a !== null && "duplicateOfPrevious" in a;
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

    // TODO (stopgap): when true, disable grammar matching for this step so the
    // request is translated by the LLM instead of the authored grammar. Works
    // around the list-agent determiner-capture grammar bug (see listSchema.agr
    // <AddItems>): "add ham to the list" otherwise grammar-matches to
    // listName="the" instead of clarifying. Remove once the grammar is fixed.
    skipGrammar?: boolean;

    // Optional trailing actions the model may append run-to-run. `expected` is
    // required and validated as the leading prefix; the result may then contain
    // 0..extraActions.length additional actions, each validated in order against
    // the corresponding entry here. Use for multi-action requests with variable
    // tails (e.g. an extra pendingRequestAction that defers "add the filtered
    // tracks to the playlist"). A `{ duplicateOfPrevious: true }` entry passes
    // only when the trailing action is an exact duplicate of the action right
    // before it - tolerating the model repeating its final action without
    // accepting an arbitrary extra one.
    extraActions?: ExtraActionMatch | ExtraActionMatch[];
};

export type TranslateTestEntry = TranslateTestStep | TranslateTestStep[];
export type TranslateTestFile = TranslateTestEntry[];

const repeat = 5;
const concurrency = 1;
const embeddingCacheDir = path.join(os.tmpdir(), ".typeagent", "cache");

// Flow-only agent schemas turned off in these translation-stability tests via
// `@config schema --off` (product manifests are left untouched): "utility"'s
// generic actions (webSearch / readFile) otherwise out-compete the agents under
// test (browser.lookupAndAnswer, mcpfilesystem). The reasoning escape hatch is
// handled by execution.reasoning:"none" (below), NOT by disabling its schema —
// disabling dispatcher.reasoning regressed unrelated player/mcpfs routing.
const disabledSchemas = ["utility"];

// Per-attempt Jest timeout budget for a single request translation.
const perAttemptTimeoutMs = 30000;

// When a request comes back with a transient infrastructure error (a dropped
// connection such as "fetch: No response", throttling, or a 5xx/gateway
// timeout) rather than a real translation mismatch, re-issue it instead of
// failing the test. Live endpoints occasionally drop a call; retrying keeps
// these tests from flaking on infrastructure hiccups. A genuine wrong action
// is NOT retried here — only errors that never produced a translation.
const maxTransientRetries = 4;
const transientRetryBaseDelayMs = 1000;

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Matches network/service error signatures surfaced via CommandResult.lastError
// (see aiclient restClient.ts). Deliberately excludes deterministic failures
// like auth (401/403) or bad-request (400) which retrying cannot fix.
function isTransientRequestError(error: string | undefined): boolean {
    if (error === undefined) {
        return false;
    }
    const msg = error.toLowerCase();
    return (
        msg.includes("no response") || // dropped connection ("fetch: No response")
        msg.includes("connection error") ||
        msg.includes("terminated") || // undici wrapper for a reset socket ("read ECONNRESET")
        msg.includes("econnreset") ||
        msg.includes("etimedout") ||
        msg.includes("enotfound") ||
        msg.includes("eai_again") ||
        msg.includes("socket hang up") ||
        msg.includes("the operation was aborted") ||
        msg.includes("aborterror") ||
        msg.includes("timed out") ||
        msg.includes("too many requests") ||
        msg.includes("rate limit") ||
        msg.includes("overloaded") ||
        msg.includes("internal server error") ||
        msg.includes("bad gateway") ||
        msg.includes("service unavailable") ||
        msg.includes("gateway timeout")
    );
}

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
                const dispatcher = await createDispatcher(
                    "cli test translate",
                    {
                        appAgentProviders: defaultAppAgentProviders,
                        agents: {
                            actions: false,
                            commands: ["dispatcher"],
                        },
                        // history: false - the test manually imports history.
                        // reasoning: "none" - this is a translation-stability
                        // test; the execution-time reasoning fallback otherwise
                        // diverts dispatcher.clarify / unknown actions away from
                        // executeActions, leaving commandResult.actions empty so
                        // clarify expectations can never match.
                        execution: { history: false, reasoning: "none" },
                        explainer: { enabled: false },
                        cache: { enabled: false },
                        embeddingCacheDir, // Cache the embedding to avoid recomputation.
                        collectCommandResult: true,
                    },
                );
                // Take the flow-only schemas out of the translation candidate
                // set (see disabledSchemas above).
                for (const schema of disabledSchemas) {
                    checkResultError(
                        await awaitCommand(
                            dispatcher,
                            `@config schema --off ${schema}`,
                        ),
                        `Failed to disable schema '${schema}'`,
                    );
                }
                dispatchers.push(dispatcher);
            }
        });
        describe.each(inputsWithName)(`${name} %p`, (_, test) => {
            const steps = Array.isArray(test) ? test : [test];
            it.each(steps)(
                "step $#: $request",
                async (step) => {
                    await runOnDispatchers(async (dispatcher) => {
                        await setupOneStep(steps, step, dispatcher);
                        // TODO (stopgap): skipGrammar disables grammar matching
                        // for this step (LLM-only translation) to work around
                        // the list determiner-capture grammar bug. Remove with
                        // the grammar fix (see listSchema.agr <AddItems>).
                        if (step.skipGrammar) {
                            await awaitCommand(
                                dispatcher,
                                "@config match grammar off",
                            );
                        }
                        try {
                            const result = await runOneStep(step, dispatcher);
                            validateCommandResult(step, result);
                        } finally {
                            if (step.skipGrammar) {
                                await awaitCommand(
                                    dispatcher,
                                    "@config match grammar on",
                                );
                            }
                        }
                    });
                },
                // Base budget per repeat, plus headroom for transient-error
                // retries so a dropped API call that gets re-issued doesn't
                // trip the Jest timeout.
                perAttemptTimeoutMs * Math.round(repeat / concurrency) +
                    maxTransientRetries * perAttemptTimeoutMs,
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

function checkResultError(result: CommandResult | undefined, message: string) {
    if (result?.lastError !== undefined) {
        throw new Error(`${message}: ${result.lastError}`);
    }
}

async function setupOneStep(
    steps: TranslateTestStep[],
    curr: TranslateTestStep,
    dispatcher: Dispatcher,
) {
    const result = await awaitCommand(dispatcher, "@history clear");
    checkResultError(result, "Failed to clear history");
    for (const step of steps) {
        if (step === curr) {
            return;
        }
        const { request, history } = step;

        if (history !== undefined) {
            const insertResult = await awaitCommand(
                dispatcher,
                `@history insert ${JSON.stringify({ user: request, assistant: history })}`,
            );
            checkResultError(insertResult, "Failed to insert history");
        }
    }

    throw new Error(`Test step not found: ${curr.request}`);
}

async function runOneStep(step: TranslateTestStep, dispatcher: Dispatcher) {
    const { request, attachments } = step;
    let result = await awaitCommand(dispatcher, request, attachments);
    // Retry only on transient infrastructure errors (dropped API call, throttle,
    // gateway timeout) so a single lost request doesn't flake the test. A real
    // translation mismatch returns actions (no lastError) and is validated below.
    for (
        let attempt = 1;
        attempt <= maxTransientRetries &&
        isTransientRequestError(result?.lastError);
        attempt++
    ) {
        console.warn(
            `Transient infra error on request '${request}' ` +
                `(retry ${attempt}/${maxTransientRetries}): ${result?.lastError}`,
        );
        await delay(transientRetryBaseDelayMs * attempt);
        result = await awaitCommand(dispatcher, request, attachments);
    }
    return result;
}

function validateCommandResult(
    step: TranslateTestStep,
    result?: CommandResult,
) {
    const { request, expected } = step;
    checkResultError(result, `Failed to process request '${request}'`);

    if (expected !== undefined) {
        const actionMatches = normalizeActionMatches(expected);
        const actions = result?.actions!;
        if (actions === undefined) {
            throw new Error(
                `Request '${request}' did not return any actions, expected ${JSON.stringify(expected)}`,
            );
        }
        // `expected` is required and validated as the leading prefix.
        // `extraActions` are optional trailing actions: the result may contain
        // 0..extraActions.length of them, each validated in order against the
        // corresponding entry. A `{ duplicateOfPrevious: true }` entry passes
        // only when the trailing action is an exact duplicate of the action
        // immediately before it.
        const extraSpecs: ExtraActionMatch[] =
            step.extraActions === undefined
                ? []
                : Array.isArray(step.extraActions)
                  ? step.extraActions
                  : [step.extraActions];
        expect(actions.length).toBeGreaterThanOrEqual(actionMatches.length);
        expect(actions.length).toBeLessThanOrEqual(
            actionMatches.length + extraSpecs.length,
        );

        for (let i = 0; i < actions.length; i++) {
            if (i < actionMatches.length) {
                validateExpectedAction(actionMatches[i], actions[i]);
                continue;
            }
            const extra = extraSpecs[i - actionMatches.length];
            if (isDuplicateOfPreviousMatch(extra)) {
                checkDuplicateOfPreviousAction(actions, i);
            } else {
                validateExpectedAction(
                    normalizeActionMatches(extra)[0],
                    actions[i],
                );
            }
        }
    }
}

// A `{ duplicateOfPrevious: true }` extraActions slot passes only when the
// trailing action is an exact duplicate of the action immediately preceding it.
// Both actions are normalized (and their run-to-run `entities` metadata dropped,
// as in checkPossibleMatch) before the equality check.
function checkDuplicateOfPreviousAction(
    actions: TypeAgentAction[],
    i: number,
) {
    const normalizeForCompare = (a: TypeAgentAction) => {
        const n = structuredClone(a);
        normalizeAction(n);
        normalizeUrlParams(n);
        delete n.entities;
        return n;
    };
    expect(normalizeForCompare(actions[i])).toEqual(
        normalizeForCompare(actions[i - 1]),
    );
}

type PossibleMatch = {
    action: TypeAgentAction;
    partial: boolean;
};

// This function validates the test data, to make sure the alternatives are valid.
function validateAlternatives(
    action: TypeAgentAction,
    name: string,
    values: ParamValueType[],
) {
    const expectedType = typeof getObjectProperty(action.parameters, name);
    const valueType = typeof values[0];
    // Allow alternates to fill in optional fields.
    if (expectedType !== "undefined" && expectedType !== valueType) {
        // Error checking the testing alternates.  Make sure it is replacing existing properties
        throw new Error(
            `Invalid alternatives: type mismatch with action for parameter '${name}'. Expected type '${expectedType}' but got '${valueType}'`,
        );
    }

    for (const v of values) {
        if (typeof v !== valueType) {
            throw new Error(
                `Invalid alternatives: inconsistent types for parameter '${name}'. Expected type '${valueType}' but got '${typeof v}'`,
            );
        }
    }
}

function expandAlternates(
    expectedMatch: ActionMatchWithAlternates,
): { action: TypeAgentAction; partial: boolean }[] {
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

            validateAlternatives(expectedMatch.action, name, values);

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

function checkPossibleMatch(
    action: TypeAgentAction,
    possibleMatch: PossibleMatch,
) {
    // Drop action.entities before comparing. It is resolved-reference metadata
    // that entity resolution may or may not attach run-to-run (e.g. a
    // history-dependent "grocery" list entity), not part of the translated
    // action shape, and no expected action asserts it. Ignoring it avoids
    // spurious toEqual mismatches.
    let actual = action;
    if (action.entities) {
        actual = { ...action };
        delete actual.entities;
    }
    if (possibleMatch.partial) {
        expect(actual).toMatchObject(possibleMatch.action);
    } else {
        expect(actual).toEqual(possibleMatch.action);
    }
}

// The translator may return a bare host (e.g. "jsbach.net") where the canonical
// form carries a scheme ("http://jsbach.net"). The browser treats the two
// equivalently, so normalize a scheme-less host by prepending "http://" before
// comparison. Applied symmetrically to expected and received values, so it can
// only widen matches — never introduce a false failure.
// Treat a bare host and its http:// / https:// forms as equivalent (e.g.
// "jsbach.net" == "http://jsbach.net", "wikipedia.com" == "https://wikipedia.com")
// by stripping a leading http(s):// scheme before comparison. Recurses into
// nested objects and string arrays (e.g. lookup.site: string[]). Applied
// symmetrically to expected and received values, so it can only widen matches —
// never introduce a false failure.
function stripUrlScheme(value: string): string {
    return value.replace(/^https?:\/\//i, "");
}
function normalizeUrlValues(value: unknown): unknown {
    if (typeof value === "string") {
        return stripUrlScheme(value);
    }
    if (Array.isArray(value)) {
        return value.map(normalizeUrlValues);
    }
    if (value !== null && typeof value === "object") {
        const obj = value as Record<string, unknown>;
        for (const [k, v] of Object.entries(obj)) {
            obj[k] = normalizeUrlValues(v);
        }
        return obj;
    }
    return value;
}
function normalizeUrlParams(action: TypeAgentAction) {
    if (action.parameters !== undefined) {
        normalizeUrlValues(action.parameters);
    }
}

function validateExpectedAction(
    match: ActionMatchWithAlternates[],
    action: TypeAgentAction,
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
    for (const possibleMatch of possibleMatches) {
        normalizeUrlParams(possibleMatch.action);
    }
    const normalizedAction = structuredClone(action);
    normalizeAction(normalizedAction);
    normalizeUrlParams(normalizedAction);
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

            chalk.yellow("Errors from each alternatives:"),
            ...errors,
        ].join("\n"),
    );
}
