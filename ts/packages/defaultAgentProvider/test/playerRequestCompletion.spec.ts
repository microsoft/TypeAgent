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
import fs from "node:fs";
import path from "node:path";

const errorNamespace = "typeagent:command:completion:error";

describe("Player request completion", () => {
    let dispatcher: Dispatcher;
    const errors: string[] = [];
    let originalWrite: typeof process.stderr.write;
    const originalDebug = process.env.DEBUG;
    const originalConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
    const configDir = path.join(
        process.cwd(),
        `.player-request-completion-${process.pid}`,
    );

    beforeAll(async () => {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.mkdirSync(configDir, { recursive: true });
        process.env.TYPEAGENT_CONFIG_DIR = configDir;
        process.env.DEBUG = errorNamespace;
        originalWrite = process.stderr.write;
        process.stderr.write = ((chunk: any, ...rest: any[]) => {
            const text = typeof chunk === "string" ? chunk : String(chunk);
            if (text.includes(errorNamespace)) {
                errors.push(text);
            }
            return (originalWrite as any).call(process.stderr, chunk, ...rest);
        }) as typeof process.stderr.write;

        try {
            const { createDispatcher } = await import("agent-dispatcher");
            const {
                getDefaultAppAgentProviders,
                getDefaultConstructionProvider,
            } = await import("../src/index.js");
            dispatcher = await createDispatcher("completion-test", {
                appAgentProviders: getDefaultAppAgentProviders(undefined),
                constructionProvider: getDefaultConstructionProvider(),
            });
        } catch (error) {
            process.stderr.write = originalWrite;
            throw error;
        }
    }, 120000);

    afterAll(async () => {
        try {
            await dispatcher?.close();
        } finally {
            if (originalWrite !== undefined) {
                process.stderr.write = originalWrite;
            }
            if (originalDebug === undefined) delete process.env.DEBUG;
            else process.env.DEBUG = originalDebug;
            if (originalConfigDir === undefined) {
                delete process.env.TYPEAGENT_CONFIG_DIR;
            } else {
                process.env.TYPEAGENT_CONFIG_DIR = originalConfigDir;
            }
            fs.rmSync(configDir, { recursive: true, force: true });
        }
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
