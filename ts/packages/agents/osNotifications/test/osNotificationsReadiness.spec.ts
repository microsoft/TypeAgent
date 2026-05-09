// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the osNotifications agent's readiness/setup wiring.
 *
 * `evaluateReadiness` is a pure decision function split out from the
 * agent's `checkReadiness` hook so it can be tested without mocking
 * process.platform or the windowsWatcher module.
 *
 * `buildAndRetrySync` carries an explicit mutex on AgentContext.buildInProgress
 * to cover the case where two clients each click "Yes" on their own
 * setup-prompt cards before either build completes — the dispatcher's
 * setup-window guard only covers the synchronous setup() call, not the
 * deferred work behind a choice card.
 */

import {
    AgentContext,
    buildAndRetrySync,
    evaluateReadiness,
} from "../src/osNotificationsActionHandler.js";
import { ChoiceManager } from "@typeagent/agent-sdk/helpers/action";
import type { ActionContext } from "@typeagent/agent-sdk";

describe("evaluateReadiness", () => {
    test("ready on linux regardless of helperBuilt flag", () => {
        expect(evaluateReadiness("linux", false)).toEqual({ state: "ready" });
        expect(evaluateReadiness("linux", true)).toEqual({ state: "ready" });
    });

    test("ready on darwin (helper is Windows-only)", () => {
        expect(evaluateReadiness("darwin", false)).toEqual({ state: "ready" });
    });

    test("ready on win32 when the helper exe is present", () => {
        expect(evaluateReadiness("win32", true)).toEqual({ state: "ready" });
    });

    test("setup-required on win32 when the helper exe is missing", () => {
        const r = evaluateReadiness("win32", false);
        expect(r.state).toBe("setup-required");
        expect(r.message).toMatch(/OsNotificationListener\.exe/);
    });

    test("setup-required report includes 'details' explaining what setup runs", () => {
        const r = evaluateReadiness("win32", false);
        expect(r.state).toBe("setup-required");
        expect(r.details).toMatch(/dotnet publish/);
        expect(r.details).toMatch(/sparse WinAppSDK package/);
    });
});

describe("buildAndRetrySync — build mutex", () => {
    function makeAgentContext(
        overrides: Partial<AgentContext> = {},
    ): AgentContext {
        return {
            config: {
                mode: "toast",
                routing: "broadcast",
                redactBody: false,
                bodyMaxChars: 200,
                maxPerMinute: 20,
            } as any,
            watcher: undefined,
            enabledAt: 0,
            activeIds: new Set(),
            recentEmits: [],
            errorReported: false,
            choiceManager: new ChoiceManager(),
            buildInProgress: false,
            ...overrides,
        };
    }

    function makeActionContext(
        agentCtx: AgentContext,
    ): ActionContext<AgentContext> {
        const appended: any[] = [];
        return {
            sessionContext: {
                agentContext: agentCtx,
                notify: () => {},
            } as any,
            actionIO: {
                appendDisplay: (content: any) => appended.push(content),
                setDisplay: () => {},
                takeAction: () => {},
            } as any,
            // Test reads `appended` off the action context for assertions.
            // The framework doesn't observe this; we attach it for our own use.
            _appended: appended,
        } as any;
    }

    test("returns an in-progress error when buildInProgress is already true", async () => {
        const ctx = makeAgentContext({ buildInProgress: true });
        const actionContext = makeActionContext(ctx);

        const result = await buildAndRetrySync(actionContext);
        expect(result.error).toBeDefined();
        expect(result.error).toMatch(/already in progress/i);
        // Did not write the "Building OsNotificationListener…" status —
        // the early-return is supposed to bail before any side effects.
        expect((actionContext as any)._appended).toEqual([]);
    });

    test("does not flip the buildInProgress flag back to false on early-return", async () => {
        // Subtle but important: the early-return must NOT clear the flag,
        // otherwise the second concurrent caller would clear the lock the
        // first caller is still holding. The flag stays true until the
        // owner of the build completes (success or failure).
        const ctx = makeAgentContext({ buildInProgress: true });
        await buildAndRetrySync(makeActionContext(ctx));
        expect(ctx.buildInProgress).toBe(true);
    });
});
