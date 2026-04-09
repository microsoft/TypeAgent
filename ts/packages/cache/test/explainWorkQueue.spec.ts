// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ExplainWorkQueue,
    ExplanationOptions,
} from "../src/cache/explainWorkQueue.js";
import { ExplainerFactory } from "../src/cache/factory.js";
import { GenericExplainer } from "../src/explanation/genericExplainer.js";
import {
    createExecutableAction,
    RequestAction,
} from "../src/explanation/requestAction.js";

// Minimal mock explainer that satisfies the GenericExplainer interface
const mockExplainer: GenericExplainer = {
    generate: async () => ({
        success: true,
        data: {},
    }),
    validate: () => undefined,
};

const mockFactory: ExplainerFactory = () => mockExplainer;

function createQueue() {
    return new ExplainWorkQueue(mockFactory);
}

function makeRequestAction(
    request: string,
    parameters?: Record<string, unknown>,
) {
    const executableAction = createExecutableAction(
        "testSchema",
        "testAction",
        parameters as any,
    );
    return RequestAction.create(request, executableAction);
}

// Tests for checkExplainableValues - covers TODO:42 ("check number too")
describe("ExplainWorkQueue.checkExplainableValues", () => {
    const options: ExplanationOptions = {
        valueInRequest: true,
        noReferences: false,
        concurrent: true, // run immediately without queueing to simplify test
    };

    test("does not throw when string parameter value is present in request", async () => {
        const requestAction = makeRequestAction("play happy songs", {
            mood: "happy",
        });
        const queue = createQueue();
        await expect(
            queue.queueTask(requestAction, false, options),
        ).resolves.toBeDefined();
    });

    test("throws when string parameter value is NOT present in request", async () => {
        // "sad" is not in "play happy songs"
        const requestAction = makeRequestAction("play happy songs", {
            mood: "sad",
        });
        const queue = createQueue();
        await expect(
            queue.queueTask(requestAction, false, options),
        ).rejects.toThrow(/not found in the request/i);
    });

    test("does not validate number parameters against request (TODO:42)", async () => {
        // Number value 2024 is not in "play recent songs", but currently numbers are not validated
        // TODO:42: After the fix, this should throw (number should also be checked)
        const requestAction = makeRequestAction("play recent songs", {
            year: 2024,
        });
        const queue = createQueue();
        // Current behavior: no throw for number parameters (TODO:42 to fix)
        await expect(
            queue.queueTask(requestAction, false, options),
        ).resolves.toBeDefined();
    });

    test("validates nested string parameters", async () => {
        // Nested string "jazz" is NOT in "play rock music"
        const requestAction = makeRequestAction("play rock music", {
            filter: { genre: "jazz" },
        });
        const queue = createQueue();
        await expect(
            queue.queueTask(requestAction, false, options),
        ).rejects.toThrow(/not found in the request/i);
    });

    test("does not validate when valueInRequest is false", async () => {
        // "jazz" not in request, but validation is disabled
        const requestAction = makeRequestAction("play rock music", {
            genre: "jazz",
        });
        const queue = createQueue();
        const noValidationOptions: ExplanationOptions = {
            ...options,
            valueInRequest: false,
        };
        await expect(
            queue.queueTask(requestAction, false, noValidationOptions),
        ).resolves.toBeDefined();
    });

    test("does not throw when action has no parameters", async () => {
        const requestAction = makeRequestAction("stop playback");
        const queue = createQueue();
        await expect(
            queue.queueTask(requestAction, false, options),
        ).resolves.toBeDefined();
    });
});
