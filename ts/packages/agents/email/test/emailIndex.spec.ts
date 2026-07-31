// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    compileGrammarToNFA,
    loadGrammarRulesNoThrow,
    matchNFA,
} from "@typeagent/action-grammar";
import type {
    CommandDescriptor,
    CommandDescriptorTable,
} from "@typeagent/agent-sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");
const { instantiate, runEmailIndex } = await import(
    pathToFileURL(path.join(packageRoot, "dist", "emailActionHandler.js")).href
);
const grammarPath = path.join(packageRoot, "src", "emailSchema.agr");

function makeMatcher() {
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        "emailSchema.agr",
        fs.readFileSync(grammarPath, "utf8"),
        errors,
    );
    if (grammar === undefined || errors.length > 0) {
        throw new Error(`Failed to parse email grammar: ${errors.join("; ")}`);
    }
    const nfa = compileGrammarToNFA(grammar, "email");
    return (input: string) => {
        const result = matchNFA(nfa, input.toLowerCase().split(/\s+/), false);
        return result.matched ? result.actionValue : undefined;
    };
}

function makeContext(authenticated: boolean, indexingInProgress = false) {
    const displays: unknown[] = [];
    const agentContext = {
        emailProvider: {
            isAuthenticated: () => authenticated,
        },
        indexingInProgress,
    };
    return {
        agentContext,
        displays,
        context: {
            sessionContext: { agentContext },
            actionIO: {
                setDisplay: (content: unknown) => displays.push(content),
                appendDisplay: (content: unknown) => displays.push(content),
            },
        } as any,
    };
}

describe("indexInbox", () => {
    it("matches narrow inbox-indexing requests", () => {
        const match = makeMatcher();

        assert.deepEqual(match("index my inbox"), {
            actionName: "indexInbox",
        });
        assert.deepEqual(match("rebuild my email index"), {
            actionName: "indexInbox",
        });
    });

    it("links the index command to indexInbox", async () => {
        const descriptors = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptor
            | CommandDescriptorTable;
        assert.ok("commands" in descriptors);
        assert.equal(
            (descriptors.commands.index as CommandDescriptor).action,
            "indexInbox",
        );
    });

    it("starts indexing when authenticated", () => {
        const { context, agentContext } = makeContext(true);
        const started: unknown[] = [];

        runEmailIndex(context, (value: unknown) => started.push(value));

        assert.deepEqual(started, [agentContext]);
    });

    it("does not start indexing while signed out", () => {
        const { context } = makeContext(false);
        const started: unknown[] = [];

        runEmailIndex(context, (value: unknown) => started.push(value));

        assert.deepEqual(started, []);
    });

    it("does not start a duplicate index build", () => {
        const { context } = makeContext(true, true);
        const started: unknown[] = [];

        runEmailIndex(context, (value: unknown) => started.push(value));

        assert.deepEqual(started, []);
    });
});
