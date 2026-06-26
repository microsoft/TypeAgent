// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createWildcardMatchValidator,
    createReplaySessionContextStub,
    matchActionPayloads,
    DEFAULT_WILDCARD_VALIDATION_ALLOWLIST,
    type ReplayAppAgentLoader,
    type ReplayValidatableAgent,
} from "../src/replay/wildcardValidator.js";

/** A loader over a fixed map of fake agents, recording load/unload calls. */
function fakeLoader(
    agents: Record<string, ReplayValidatableAgent>,
    log?: { loaded: string[]; unloaded: string[] },
): ReplayAppAgentLoader {
    return {
        async loadAppAgent(name) {
            log?.loaded.push(name);
            const agent = agents[name];
            if (agent === undefined) {
                throw new Error(`no such agent: ${name}`);
            }
            return agent;
        },
        async unloadAppAgent(name) {
            log?.unloaded.push(name);
        },
    };
}

/** One grammar-match action wrapper `{ action }`, as `match.actions` carries. */
function action(actionName: string, parameters?: Record<string, unknown>) {
    return {
        action: {
            schemaName: "demo",
            actionName,
            ...(parameters !== undefined ? { parameters } : {}),
        },
    };
}

describe("createWildcardMatchValidator", () => {
    it("accepts (no-op) and diagnoses when the agent is not in the allowlist", async () => {
        const log = { loaded: [] as string[], unloaded: [] as string[] };
        const validator = createWildcardMatchValidator("notallowed", {
            loader: fakeLoader({ notallowed: {} }, log),
            allowlist: ["timer"],
        });
        const outcome = await validator.validateMatch([action("doThing")]);
        expect(outcome.rejected).toBe(false);
        expect(outcome.diagnostic).toBe("agent-not-in-allowlist");
        // Never even loaded the module.
        expect(log.loaded).toEqual([]);
        expect(validator.loaded).toBe(false);
        expect([...validator.diagnostics]).toContain("agent-not-in-allowlist");
        await validator.dispose();
        expect(log.unloaded).toEqual([]);
    });

    it("rejects when the agent validator returns false", async () => {
        const agent: ReplayValidatableAgent = {
            async validateWildcardMatch(a) {
                return (a as { actionName: string }).actionName !== "bad";
            },
        };
        const validator = createWildcardMatchValidator("timer", {
            loader: fakeLoader({ timer: agent }),
            allowlist: ["timer"],
        });
        expect((await validator.validateMatch([action("good")])).rejected).toBe(
            false,
        );
        expect((await validator.validateMatch([action("bad")])).rejected).toBe(
            true,
        );
    });

    it("rejects the whole match if ANY action's validator returns false", async () => {
        const agent: ReplayValidatableAgent = {
            async validateWildcardMatch(a) {
                return (a as { actionName: string }).actionName !== "bad";
            },
        };
        const validator = createWildcardMatchValidator("timer", {
            loader: fakeLoader({ timer: agent }),
            allowlist: ["timer"],
        });
        const outcome = await validator.validateMatch([
            action("good"),
            action("bad"),
        ]);
        expect(outcome.rejected).toBe(true);
    });

    it("fails open with a diagnostic when the validator throws", async () => {
        const agent: ReplayValidatableAgent = {
            async validateWildcardMatch() {
                throw new Error("boom");
            },
        };
        const validator = createWildcardMatchValidator("timer", {
            loader: fakeLoader({ timer: agent }),
            allowlist: ["timer"],
        });
        const outcome = await validator.validateMatch([action("x")]);
        expect(outcome.rejected).toBe(false);
        expect([...validator.diagnostics]).toContain("errored");
    });

    it("fails open with a diagnostic when the module fails to load", async () => {
        const validator = createWildcardMatchValidator("timer", {
            // Loader has no "timer" → loadAppAgent throws.
            loader: fakeLoader({}),
            allowlist: ["timer"],
        });
        const outcome = await validator.validateMatch([action("x")]);
        expect(outcome.rejected).toBe(false);
        expect(outcome.diagnostic).toBe("load-failed");
        expect([...validator.diagnostics]).toContain("load-failed");
        // A failed load is not retried.
        await validator.validateMatch([action("y")]);
    });

    it("accepts (no-op) when the agent has no validateWildcardMatch", async () => {
        const validator = createWildcardMatchValidator("timer", {
            loader: fakeLoader({ timer: {} }),
            allowlist: ["timer"],
        });
        const outcome = await validator.validateMatch([action("x")]);
        expect(outcome.rejected).toBe(false);
        expect(outcome.diagnostic).toBe("no-validator");
    });

    it("does not throw for an in-process validator reading agentContext (empty stub)", async () => {
        // A hypothetical in-process validator that reads context.agentContext
        // and returns true when its client is absent. Our stub uses
        // `agentContext: {}` (NOT undefined), so this must not throw. (The real
        // player validator has this shape but runs out-of-process, so it's
        // excluded from the default allowlist; here we override the allowlist to
        // exercise the stub's defensive behaviour directly.)
        const playerLike: ReplayValidatableAgent = {
            async validateWildcardMatch(_a, context) {
                const spotify = (
                    context as { agentContext?: { spotify?: unknown } }
                ).agentContext?.spotify;
                if (spotify === undefined) {
                    return true;
                }
                return false;
            },
        };
        const validator = createWildcardMatchValidator("player", {
            loader: fakeLoader({ player: playerLike }),
            allowlist: ["player"],
        });
        const outcome = await validator.validateMatch([action("playTrack")]);
        expect(outcome.rejected).toBe(false);
        expect(outcome.diagnostic).toBeUndefined();
    });

    it("loads the module lazily and only once, then unloads on dispose", async () => {
        const log = { loaded: [] as string[], unloaded: [] as string[] };
        const agent: ReplayValidatableAgent = {
            async validateWildcardMatch() {
                return true;
            },
        };
        const validator = createWildcardMatchValidator("timer", {
            loader: fakeLoader({ timer: agent }, log),
            allowlist: ["timer"],
        });
        // Not loaded until first validateMatch.
        expect(log.loaded).toEqual([]);
        await validator.validateMatch([action("a")]);
        await validator.validateMatch([action("b")]);
        expect(log.loaded).toEqual(["timer"]); // exactly once
        expect(validator.loaded).toBe(true);
        await validator.dispose();
        expect(log.unloaded).toEqual(["timer"]);
    });

    it("dispose is a no-op when nothing was loaded", async () => {
        const log = { loaded: [] as string[], unloaded: [] as string[] };
        const validator = createWildcardMatchValidator("notallowed", {
            loader: fakeLoader({}, log),
            allowlist: ["timer"],
        });
        await validator.dispose();
        expect(log.unloaded).toEqual([]);
    });

    it("ships timer/list as the default allowlist", () => {
        expect([...DEFAULT_WILDCARD_VALIDATION_ALLOWLIST].sort()).toEqual([
            "list",
            "timer",
        ]);
    });
});

describe("createReplaySessionContextStub", () => {
    it("exposes an empty (non-undefined) agentContext", () => {
        const stub = createReplaySessionContextStub();
        expect(stub.agentContext).toEqual({});
    });

    it("throws on interactive methods (validators must not call them)", () => {
        const stub = createReplaySessionContextStub();
        expect(() => (stub.popupQuestion as () => unknown)()).toThrow();
    });
});

describe("matchActionPayloads", () => {
    it("unwraps `{ action }` entries and passes through bare values", () => {
        expect(
            matchActionPayloads([{ action: { actionName: "x" } }, 42]),
        ).toEqual([{ actionName: "x" }, 42]);
    });
});
