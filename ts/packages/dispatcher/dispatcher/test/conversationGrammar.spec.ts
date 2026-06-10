// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
    compileGrammarToNFA,
    loadGrammarRulesNoThrow,
    matchNFA,
} from "action-grammar";

// Resolve the .agr source from the package root regardless of where the
// compiled spec runs from.  __dirname is dist/test/, so go up two levels
// to the package root, then into src/.
const here = path.dirname(fileURLToPath(import.meta.url));
const grammarPath = path.resolve(
    here,
    "..",
    "..",
    "src",
    "context",
    "system",
    "schema",
    "conversationActionSchema.agr",
);

function makeMatcher() {
    const content = fs.readFileSync(grammarPath, "utf-8");
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        "conversationActionSchema.agr",
        content,
        errors,
    );
    if (errors.length > 0 || grammar === undefined) {
        throw new Error(
            `Failed to parse conversation grammar: ${errors.join("; ")}`,
        );
    }
    const nfa = compileGrammarToNFA(grammar, "system.conversation");
    return (input: string) => {
        const tokens = input.toLowerCase().split(/\s+/);
        const r = matchNFA(nfa, tokens, false);
        return r.matched ? (r.actionValue as any) : undefined;
    };
}

describe("system.conversation grammar", () => {
    const match = makeMatcher();

    describe("listConversation", () => {
        it.each([
            "list conversations",
            "list my conversations",
            "list our conversations",
            "show conversations",
            "show all conversations",
            "show my chats",
            "display sessions",
            "what conversations do i have",
            "which chats do i have",
            "please list conversations",
            "can you show my conversations",
        ])("matches %p", (input) => {
            const r = match(input);
            expect(r).toBeDefined();
            expect(r.actionName).toBe("listConversation");
        });
    });

    describe("switchConversation", () => {
        it("matches 'switch conversation to X'", () => {
            const r = match("switch conversation to work");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("switchConversation");
            expect(r.parameters.name).toBe("work");
        });

        it("matches 'switch to conversation X'", () => {
            const r = match("switch to conversation work");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("switchConversation");
            expect(r.parameters.name).toBe("work");
        });

        it("matches 'go to the X conversation'", () => {
            const r = match("go to the work conversation");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("switchConversation");
            expect(r.parameters.name).toBe("work");
        });

        it("matches 'open conversation named X'", () => {
            const r = match("open conversation named research");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("switchConversation");
            expect(r.parameters.name).toBe("research");
        });

        it("does NOT match bare 'switch to X' (no conversation anchor)", () => {
            // This avoids stealing matches from agents like browser/player that
            // legitimately use 'switch to X' for their own domain (e.g.
            // setPreferredStore).  Only anchored phrasings should match.
            expect(match("switch to test")).toBeUndefined();
        });
    });

    describe("nextConversation / prevConversation beat wildcard switchConversation", () => {
        it("'switch to next conversation' prefers nextConversation", () => {
            const r = match("switch to next conversation");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("nextConversation");
        });

        it("'go to previous conversation' prefers prevConversation", () => {
            const r = match("go to previous conversation");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("prevConversation");
        });

        it("'next conversation' matches nextConversation", () => {
            const r = match("next conversation");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("nextConversation");
        });
    });

    describe("newConversation", () => {
        it("matches 'new conversation' (no name)", () => {
            const r = match("new conversation");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("newConversation");
        });

        it("matches 'create a new conversation called X'", () => {
            const r = match("create a new conversation called test");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("newConversation");
            expect(r.parameters.name).toBe("test");
        });

        it("matches 'start a new chat named X'", () => {
            const r = match("start a new chat named research");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("newConversation");
            expect(r.parameters.name).toBe("research");
        });
    });

    describe("renameConversation", () => {
        it("matches 'rename this conversation to X'", () => {
            const r = match("rename this conversation to work");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("renameConversation");
            expect(r.parameters.newName).toBe("work");
        });

        it("matches 'rename conversation X to Y' (both names)", () => {
            const r = match("rename conversation old to new");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("renameConversation");
            expect(r.parameters.name).toBe("old");
            expect(r.parameters.newName).toBe("new");
        });
    });

    describe("deleteConversation", () => {
        it("matches 'delete conversation X'", () => {
            const r = match("delete conversation test");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("deleteConversation");
            expect(r.parameters.name).toBe("test");
        });

        it("matches 'remove the X conversation'", () => {
            const r = match("remove the test conversation");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("deleteConversation");
            expect(r.parameters.name).toBe("test");
        });
    });

    describe("showConversationInfo", () => {
        it("matches 'show conversation info'", () => {
            const r = match("show conversation info");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("showConversationInfo");
        });

        it("matches 'what conversation am i in'", () => {
            const r = match("what conversation am i in");
            expect(r).toBeDefined();
            expect(r.actionName).toBe("showConversationInfo");
        });
    });
});
