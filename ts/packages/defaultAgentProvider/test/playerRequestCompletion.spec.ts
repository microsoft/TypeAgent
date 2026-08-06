// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Guards request completion for the player agent end to end.
//
// Song/artist autocompletion has broken in ways that produced no visible
// error, because every layer swallows failures:
//
//  - `GrammarStoreImpl.completion` threw a TypeError on a grammar property
//    that carries no resolved action. `getCommandCompletion` catches
//    everything into a debug-only channel, so one bad property silently wiped
//    out completions for the whole request -- including the ones the
//    construction cache had already produced correctly.
//  - The shipped built-in construction cache rotting is covered separately by
//    builtinConstructions.spec.ts.
//
// This drives the real dispatcher and asserts on the debug channel that
// receives the swallowed exceptions, since a thrown completion is otherwise
// indistinguishable from a legitimately empty one.
//
// `DEBUG` has to be set before agent-dispatcher is loaded (debug resolves
// namespaces when each instance is created), hence the dynamic imports.

import type { Dispatcher } from "agent-dispatcher";

const errorNamespace = "typeagent:command:completion:error";

describe("Player request completion", () => {
    let dispatcher: Dispatcher;
    const errors: string[] = [];
    let originalWrite: typeof process.stderr.write;

    beforeAll(async () => {
        process.env.DEBUG = errorNamespace;

        const { createDispatcher } = await import("agent-dispatcher");
        const { getDefaultAppAgentProviders, getDefaultConstructionProvider } =
            await import("../src/index.js");

        // debug logs through process.stderr.write on node; capturing there
        // avoids depending on which copy of the debug module got loaded.
        originalWrite = process.stderr.write.bind(process.stderr);
        process.stderr.write = ((chunk: any, ...rest: any[]) => {
            const text = typeof chunk === "string" ? chunk : String(chunk);
            if (text.includes(errorNamespace)) {
                errors.push(text);
            }
            return (originalWrite as any)(chunk, ...rest);
        }) as typeof process.stderr.write;

        dispatcher = await createDispatcher("completion-test", {
            appAgentProviders: getDefaultAppAgentProviders(undefined),
            constructionProvider: getDefaultConstructionProvider(),
        });
    }, 120000);

    afterAll(async () => {
        if (originalWrite !== undefined) {
            process.stderr.write = originalWrite;
        }
        delete process.env.DEBUG;
        await dispatcher?.close();
    });

    it.each(["play ", "play music by ", "listen to "])(
        "completes '%s' without a swallowed error",
        async (input) => {
            errors.length = 0;
            await dispatcher.getCommandCompletion(input, "forward");
            expect(errors).toEqual([]);
        },
        30000,
    );
});
