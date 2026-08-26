// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
    compileGrammarToNFA,
    loadGrammarRulesNoThrow,
    matchNFA,
} from "@typeagent/action-grammar";
import type {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";
import { getPlayerCommandInterface } from "../src/agent/playerCommands.js";
import {
    runLoadSpotifyUserData,
    runSpotifyLogin,
    runSpotifyLogout,
} from "../src/agent/playerHandlers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarPath = path.resolve(
    here,
    "..",
    "..",
    "src",
    "agent",
    "playerSchema.agr",
);

function makeMatcher() {
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        "playerSchema.agr",
        fs.readFileSync(grammarPath, "utf8"),
        errors,
    );
    if (grammar === undefined || errors.length > 0) {
        throw new Error(`Failed to parse player grammar: ${errors.join("; ")}`);
    }
    const nfa = compileGrammarToNFA(grammar, "player");
    return (input: string) => {
        const result = matchNFA(nfa, input.toLowerCase().split(/\s+/), false);
        return result.matched ? (result.actionValue as any) : undefined;
    };
}

function makeContext(spotify?: object, instanceStorage?: object) {
    const displays: unknown[] = [];
    const sessionContext = {
        agentContext: { spotify },
        instanceStorage,
    };
    return {
        sessionContext,
        displays,
        context: {
            sessionContext,
            actionIO: {
                setDisplay: (value: unknown) => displays.push(value),
                appendDisplay: (value: unknown) => displays.push(value),
            },
        } as any,
    };
}

describe("player Spotify management actions", () => {
    it("matches login, logout, and history-load requests", () => {
        const match = makeMatcher();

        expect(match("log in to spotify")).toEqual({
            actionName: "spotifyLogin",
        });
        expect(match("sign out of spotify")).toEqual({
            actionName: "spotifyLogout",
        });
        expect(match("load my spotify user data history.json")).toEqual({
            actionName: "loadSpotifyUserData",
            parameters: { file: "history.json" },
        });
    });

    it("links all nested commands to their actions", async () => {
        const root = (await getPlayerCommandInterface().getCommands(
            {} as any,
        )) as CommandDescriptorTable;
        const spotify = root.commands.spotify as CommandDescriptorTable;

        expect((spotify.commands.load as CommandDescriptor).action).toBe(
            "loadSpotifyUserData",
        );
        expect((spotify.commands.login as CommandDescriptor).action).toBe(
            "spotifyLogin",
        );
        expect((spotify.commands.logout as CommandDescriptor).action).toBe(
            "spotifyLogout",
        );
    });

    it("logs in only when no Spotify context exists", async () => {
        const { context, sessionContext } = makeContext();
        const calls: unknown[] = [];

        await runSpotifyLogin(context, async (value) => {
            calls.push(value);
            return "Ada";
        });

        expect(calls).toEqual([sessionContext]);
    });

    it("does not log in twice", async () => {
        const spotify = {
            service: { retrieveUser: () => ({ username: "Ada" }) },
        };
        const { context } = makeContext(spotify);
        const calls: unknown[] = [];

        await runSpotifyLogin(context, async (value) => {
            calls.push(value);
            return "ignored";
        });

        expect(calls).toEqual([]);
    });

    it("logs out with refresh-token clearing", async () => {
        const spotify = {};
        const { context, sessionContext } = makeContext(spotify);
        const calls: unknown[][] = [];

        await runSpotifyLogout(context, async (...args) => {
            calls.push(args);
        });

        expect(calls).toEqual([[sessionContext, true]]);
    });

    it("passes storage, file, and client context to history loading", async () => {
        const spotify = {};
        const storage = {};
        const { context } = makeContext(spotify, storage);
        const calls: unknown[][] = [];

        await runLoadSpotifyUserData(
            context,
            "history.json",
            async (...args: any[]) => {
                calls.push(args);
                return { records: 3, loaded: ["history.json"], skipped: [] };
            },
        );

        expect(calls).toEqual([[storage, "history.json", spotify]]);
    });
});
