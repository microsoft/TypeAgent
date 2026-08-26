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

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarPath = path.resolve(
    here,
    "..",
    "..",
    "src",
    "agent",
    "localPlayerSchema.agr",
);

function makeMatcher() {
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        "localPlayerSchema.agr",
        fs.readFileSync(grammarPath, "utf-8"),
        errors,
    );
    if (grammar === undefined || errors.length > 0) {
        throw new Error(
            `Failed to parse localPlayer grammar: ${errors.join("; ")}`,
        );
    }
    const nfa = compileGrammarToNFA(grammar, "localPlayer");
    return (input: string) => {
        const result = matchNFA(nfa, input.toLowerCase().split(/\s+/), false);
        return result.matched ? (result.actionValue as any) : undefined;
    };
}

describe("localPlayer command-equivalent grammar", () => {
    const match = makeMatcher();

    it.each(["play", "play music", "play the audio"])(
        "maps %p to general play",
        (input) => {
            expect(match(input)).toEqual({ actionName: "play" });
        },
    );

    it("keeps numbered tracks on playFromQueue", () => {
        expect(match("play track 3")).toEqual({
            actionName: "playFromQueue",
            parameters: { trackNumber: 3 },
        });
    });

    it("maps explicit shuffle toggling to toggleShuffle", () => {
        expect(match("toggle shuffle")).toEqual({
            actionName: "toggleShuffle",
        });
    });

    it("distinguishes toggle mute from mute and unmute setters", () => {
        expect(match("toggle mute")).toEqual({ actionName: "toggleMute" });
        expect(match("mute")).toEqual({
            actionName: "mute",
            parameters: { isMuted: true },
        });
        expect(match("unmute")).toEqual({
            actionName: "mute",
            parameters: { isMuted: false },
        });
    });
});
