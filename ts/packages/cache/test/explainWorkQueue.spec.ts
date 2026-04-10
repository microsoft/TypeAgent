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

    test("throws when number parameter value is NOT present in request", async () => {
        // 2024 is not mentioned in "play recent songs"
        const requestAction = makeRequestAction("play recent songs", {
            year: 2024,
        });
        const queue = createQueue();
        await expect(
            queue.queueTask(requestAction, false, options),
        ).rejects.toThrow(/not found in the request/i);
    });

    test("does not throw when number parameter value IS present in request", async () => {
        const requestAction = makeRequestAction("play songs from 2024", {
            year: 2024,
        });
        const queue = createQueue();
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
