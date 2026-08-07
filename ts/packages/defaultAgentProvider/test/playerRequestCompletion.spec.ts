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
import type { AppAgent } from "@typeagent/agent-sdk";
import type { AppAgentProvider } from "agent-dispatcher";
import { getPlayerActionCompletion } from "@typeagent/music/agent/handlers";
import fs from "node:fs";
import path from "node:path";

const errorNamespace = "typeagent:command:completion:error";

describe("Player request completion", () => {
    let dispatcher: Dispatcher;
    const errors: string[] = [];
    let originalWrite: typeof process.stderr.write;
    const originalDebug = process.env.DEBUG;
    const originalConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
    const originalSpotifyConfig = {
        clientId: process.env.SPOTIFY_APP_CLI,
        clientSecret: process.env.SPOTIFY_APP_CLISEC,
        port: process.env.SPOTIFY_APP_PORT,
    };
    const configDir = path.join(
        process.cwd(),
        `.player-request-completion-${process.pid}`,
    );
    const receivedPartialValues: string[] = [];

    beforeAll(async () => {
        fs.rmSync(configDir, { recursive: true, force: true });
        fs.mkdirSync(configDir, { recursive: true });
        process.env.TYPEAGENT_CONFIG_DIR = configDir;
        process.env.DEBUG = errorNamespace;
        process.env.SPOTIFY_APP_CLI = "completion-test-client";
        process.env.SPOTIFY_APP_CLISEC = "completion-test-secret";
        process.env.SPOTIFY_APP_PORT = "9999";
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
            const providers = getDefaultAppAgentProviders(undefined);
            const bundled = providers[0];
            const wrappedBundled: AppAgentProvider = {
                getAppAgentNames: () => bundled.getAppAgentNames(),
                getAppAgentManifest: (name) =>
                    bundled.getAppAgentManifest(name),
                async loadAppAgent(name) {
                    const agent = await bundled.loadAppAgent(name);
                    if (name !== "player") return agent;
                    return {
                        ...agent,
                        getActionCompletion: async (
                            _context,
                            action,
                            propertyName,
                            entityType,
                        ) => {
                            const partial =
                                (action as any).parameters?.target?.trackName ??
                                "";
                            receivedPartialValues.push(partial);
                            return getPlayerActionCompletion(
                                {
                                    agentContext: {
                                        spotify: {
                                            userData: {
                                                data: createCompletionUserData(),
                                            },
                                        },
                                    },
                                } as any,
                                action,
                                propertyName,
                                entityType,
                            );
                        },
                    } satisfies AppAgent;
                },
                unloadAppAgent: (name) => bundled.unloadAppAgent(name),
            };
            dispatcher = await createDispatcher("completion-test", {
                appAgentProviders: [wrappedBundled, ...providers.slice(1)],
                constructionProvider: getDefaultConstructionProvider(),
            });
            const enabled = await dispatcher.submitCommand(
                "@config agent player",
            );
            if (!enabled.ok) {
                throw new Error(
                    `Unable to enable player agent: ${enabled.error}`,
                );
            }
            await enabled.entry.completion;
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
            restoreEnv("SPOTIFY_APP_CLI", originalSpotifyConfig.clientId);
            restoreEnv(
                "SPOTIFY_APP_CLISEC",
                originalSpotifyConfig.clientSecret,
            );
            restoreEnv("SPOTIFY_APP_PORT", originalSpotifyConfig.port);
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

    it("filters an older multiword track before applying the agent cap", async () => {
        receivedPartialValues.length = 0;

        const result = await dispatcher.getCommandCompletion(
            "play Bohemian Rhap",
            "backward",
        );
        const completions = result.completions.flatMap(
            (group) => group.completions,
        );

        expect(result.startIndex).toBe("play".length);
        expect(receivedPartialValues).toContain("Bohemian Rhap");
        expect(completions).toContain("Bohemian Rhapsody");
        expect(completions).not.toContain("Recent unrelated track 100");
    }, 30000);
});

function createCompletionUserData() {
    const tracks = new Map<string, any>();
    tracks.set("bohemian", {
        id: "bohemian",
        name: "Bohemian Rhapsody",
        freq: 1,
        timestamps: ["2000-01-01T00:00:00.000Z"],
    });
    for (let i = 0; i < 101; i++) {
        tracks.set(`recent-${i}`, {
            id: `recent-${i}`,
            name: `Recent unrelated track ${i}`,
            freq: 1,
            timestamps: [new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString()],
        });
    }

    return {
        lastUpdated: Date.now(),
        tracks,
        artists: new Map(),
        albums: new Map(),
    };
}

function restoreEnv(name: string, value: string | undefined) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
}
