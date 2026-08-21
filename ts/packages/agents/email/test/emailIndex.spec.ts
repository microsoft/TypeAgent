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
    const sessionContext = {
        agentContext,
        notifyReadinessChanged: async () => {},
    };
    return {
        agentContext,
        displays,
        context: {
            sessionContext,
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

describe("email auth actions", () => {
    it("matches anchored login, logout, and Google authorization requests", () => {
        const match = makeMatcher();

        assert.deepEqual(match("log in to email"), {
            actionName: "emailLogin",
        });
        assert.deepEqual(match("sign out of gmail"), {
            actionName: "emailLogout",
        });
        assert.deepEqual(
            match("complete gmail authorization with code 4/abc123"),
            {
                actionName: "emailGoogleAuth",
                parameters: { code: "4/abc123" },
            },
        );
    });

    it("links all auth commands to their actions", async () => {
        const descriptors = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptor
            | CommandDescriptorTable;
        assert.ok("commands" in descriptors);
        assert.equal(
            (descriptors.commands.login as CommandDescriptor).action,
            "emailLogin",
        );
        assert.equal(
            (descriptors.commands.logout as CommandDescriptor).action,
            "emailLogout",
        );
        assert.equal(
            (descriptors.commands["google-auth"] as CommandDescriptor).action,
            "emailGoogleAuth",
        );
    });

    it("re-emits identity when login is already authenticated", async () => {
        const agent = instantiate();
        let readinessCalls = 0;
        const displays: unknown[] = [];
        const agentContext = {
            emailProvider: {
                isAuthenticated: () => true,
                getUser: async () => ({
                    displayName: "Ada",
                    email: "ada@example.com",
                }),
            },
            providerType: "microsoft",
        };
        const context = {
            sessionContext: {
                agentContext,
                notifyReadinessChanged: async () => {
                    readinessCalls++;
                },
            },
            actionIO: {
                setDisplay: (value: unknown) => displays.push(value),
                appendDisplay: (value: unknown) => displays.push(value),
            },
        } as any;

        await agent.executeAction!(
            { schemaName: "email", actionName: "emailLogin" } as any,
            context,
        );

        assert.match(JSON.stringify(displays), /ada@example\.com/);
        assert.match(JSON.stringify(displays), /typeagent-user-signed-in/);
        assert.equal(readinessCalls, 1);
    });

    it("logs out and refreshes cached readiness", async () => {
        const agent = instantiate();
        let logoutCalls = 0;
        let readinessCalls = 0;
        const displays: unknown[] = [];
        const context = {
            sessionContext: {
                agentContext: {
                    emailProvider: {
                        logout: () => {
                            logoutCalls++;
                            return true;
                        },
                    },
                },
                notifyReadinessChanged: async () => {
                    readinessCalls++;
                },
            },
            actionIO: {
                setDisplay: (value: unknown) => displays.push(value),
                appendDisplay: (value: unknown) => displays.push(value),
            },
        } as any;

        await agent.executeAction!(
            { schemaName: "email", actionName: "emailLogout" } as any,
            context,
        );

        assert.equal(logoutCalls, 1);
        assert.equal(readinessCalls, 1);
        assert.match(JSON.stringify(displays), /typeagent-user-signed-out/);
    });

    it("forwards the Google authorization code unchanged", async () => {
        const agent = instantiate();
        const codes: string[] = [];
        const displays: unknown[] = [];
        const context = {
            sessionContext: {
                agentContext: {
                    providerType: "google",
                    emailProvider: {
                        completeAuth: async (code: string) => {
                            codes.push(code);
                            return false;
                        },
                    },
                },
            },
            actionIO: {
                setDisplay: (value: unknown) => displays.push(value),
                appendDisplay: (value: unknown) => displays.push(value),
            },
        } as any;

        await agent.executeAction!(
            {
                schemaName: "email",
                actionName: "emailGoogleAuth",
                parameters: { code: "4/AbC-123_exact" },
            } as any,
            context,
        );

        assert.deepEqual(codes, ["4/AbC-123_exact"]);
    });
});
