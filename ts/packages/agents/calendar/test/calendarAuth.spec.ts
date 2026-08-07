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
import {
    instantiate,
    runCalendarLogin,
} from "../src/calendarActionHandlerV3.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const grammarPath = path.resolve(here, "..", "..", "src", "calendarSchema.agr");

function makeMatcher() {
    const errors: string[] = [];
    const grammar = loadGrammarRulesNoThrow(
        "calendarSchema.agr",
        fs.readFileSync(grammarPath, "utf8"),
        errors,
    );
    if (grammar === undefined || errors.length > 0) {
        throw new Error(
            `Failed to parse calendar grammar: ${errors.join("; ")}`,
        );
    }
    const nfa = compileGrammarToNFA(grammar, "calendar");
    return (input: string) => {
        const result = matchNFA(nfa, input.toLowerCase().split(/\s+/), false);
        return result.matched ? (result.actionValue as any) : undefined;
    };
}

describe("calendar auth actions", () => {
    it("matches anchored login, logout, and Google authorization requests", () => {
        const match = makeMatcher();

        expect(match("log in to my calendar")).toEqual({
            actionName: "calendarLogin",
        });
        expect(match("sign out of google calendar")).toEqual({
            actionName: "calendarLogout",
        });
        expect(
            match("complete google calendar authorization with code 4/abc123"),
        ).toEqual({
            actionName: "calendarGoogleAuth",
            parameters: { code: "4/abc123" },
        });
    });

    it("links all auth commands to their actions", async () => {
        const descriptors = (await instantiate().getCommands!({} as any)) as
            | CommandDescriptor
            | CommandDescriptorTable;
        expect("commands" in descriptors).toBe(true);
        if (!("commands" in descriptors)) return;

        expect((descriptors.commands.login as CommandDescriptor).action).toBe(
            "calendarLogin",
        );
        expect((descriptors.commands.logout as CommandDescriptor).action).toBe(
            "calendarLogout",
        );
        expect(
            (descriptors.commands["google-auth"] as CommandDescriptor).action,
        ).toBe("calendarGoogleAuth");
    });

    it("re-emits identity when login is already authenticated", async () => {
        const agent = instantiate();
        let readinessCalls = 0;
        const displays: unknown[] = [];
        const context = {
            sessionContext: {
                agentContext: {
                    calendarProvider: {
                        isAuthenticated: () => true,
                        getUser: async () => ({
                            displayName: "Ada",
                            email: "ada@example.com",
                        }),
                    },
                    providerType: "microsoft",
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
            { schemaName: "calendar", actionName: "calendarLogin" } as any,
            context,
        );

        expect(JSON.stringify(displays)).toMatch(/ada@example\.com/);
        expect(JSON.stringify(displays)).toMatch(/typeagent-user-signed-in/);
        expect(readinessCalls).toBe(1);
    });

    it("logs out and refreshes cached readiness", async () => {
        const agent = instantiate();
        let logoutCalls = 0;
        let readinessCalls = 0;
        const displays: unknown[] = [];
        const context = {
            sessionContext: {
                agentContext: {
                    calendarProvider: {
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
            { schemaName: "calendar", actionName: "calendarLogout" } as any,
            context,
        );

        expect(logoutCalls).toBe(1);
        expect(readinessCalls).toBe(1);
        expect(JSON.stringify(displays)).toMatch(/typeagent-user-signed-out/);
    });

    it("refreshes readiness after setup login completes", async () => {
        let readinessCalls = 0;
        const displays: unknown[] = [];
        const context = {
            sessionContext: {
                agentContext: {
                    calendarProvider: {
                        login: async () => true,
                        getUser: async () => ({
                            displayName: "Ada",
                            email: "ada@example.com",
                        }),
                    },
                    providerType: "microsoft",
                },
                notifyReadinessChanged: async () => {
                    readinessCalls++;
                },
            },
            actionIO: {
                appendDisplay: (value: unknown) => displays.push(value),
            },
        } as any;

        await runCalendarLogin(context);

        expect(readinessCalls).toBe(1);
        expect(JSON.stringify(displays)).toMatch(/typeagent-user-signed-in/);
        expect(JSON.stringify(displays)).toMatch(/ada@example\.com/);
    });

    it("forwards the Google authorization code unchanged", async () => {
        const agent = instantiate();
        const codes: string[] = [];
        const displays: unknown[] = [];
        const context = {
            sessionContext: {
                agentContext: {
                    providerType: "google",
                    calendarProvider: {
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
                schemaName: "calendar",
                actionName: "calendarGoogleAuth",
                parameters: { code: "4/AbC-123_exact" },
            } as any,
            context,
        );

        expect(codes).toEqual(["4/AbC-123_exact"]);
    });
});
