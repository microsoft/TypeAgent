// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describe, expect, test } from "@jest/globals";
import type { DispatcherConnectOptions } from "@typeagent/agent-server-protocol";
import {
    MAX_STRUCTURED_ACTION_BINDINGS,
    STRUCTURED_ACTION_BINDING_IDLE_MS,
    StructuredActionBindings,
    validateStructuredActionJoin,
} from "../src/structuredActionBindings.js";

function fixture() {
    let session = {};
    let now = 1;
    const bindings = new StructuredActionBindings(
        () => session,
        () => now,
    );
    return {
        bindings,
        replaceSession() {
            session = {};
        },
        advance(ms: number) {
            now += ms;
        },
    };
}

describe("structured action logical bindings", () => {
    test("issues isolated high-entropy capabilities and hides them from access", () => {
        const { bindings } = fixture();
        const first = bindings.acquire("conversation", "one");
        const second = bindings.acquire("conversation", "two");
        expect(first.resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(second.resumeToken).not.toBe(first.resumeToken);
        expect(first.access().scope).not.toBe(second.access().scope);
        expect(first.access().canDiscoverSchema("list")).toBe(true);
        expect(JSON.stringify(first.access())).not.toContain(first.resumeToken);
    });

    test("resumes only the same live conversation and revokes the old facade", () => {
        const { bindings } = fixture();
        const first = bindings.acquire("conversation", "one");
        const scope = first.access().scope;
        expect(() =>
            bindings.acquire("different", "two", first.resumeToken),
        ).toThrow("resume state is unavailable");
        expect(first.access().scope).toBe(scope);

        const second = bindings.acquire(
            "conversation",
            "two",
            first.resumeToken,
        );
        expect(second.access().scope).toBe(scope);
        expect(first.access().scope).not.toBe(scope);
        expect(first.access().canDiscoverSchema("list")).toBe(false);
        first.release();
        expect(second.access().canDiscoverSchema("list")).toBe(true);
    });

    test("the most recent takeover wins without resurrecting prior leases", () => {
        const { bindings } = fixture();
        const first = bindings.acquire("conversation", "one");
        const scope = first.access().scope;
        const second = bindings.acquire(
            "conversation",
            "two",
            first.resumeToken,
        );
        const third = bindings.acquire(
            "conversation",
            "three",
            first.resumeToken,
        );
        expect(third.access().scope).toBe(scope);
        for (const stale of [first, second]) {
            expect(stale.access().canDiscoverSchema("list")).toBe(false);
        }
        third.release();
        expect(third.access().canDiscoverSchema("list")).toBe(false);
        const fourth = bindings.acquire(
            "conversation",
            "four",
            first.resumeToken,
        );
        expect(fourth.access().scope).toBe(scope);
        expect(second.access().canDiscoverSchema("list")).toBe(false);
    });

    test("a policy snapshot also stops disclosing after takeover", () => {
        const { bindings } = fixture();
        const first = bindings.acquire("conversation", "one");
        const policy = first.access();
        bindings.acquire("conversation", "two", first.resumeToken);
        expect(policy.canDiscoverSchema("list")).toBe(false);
    });

    test("released ownership resumes within its lifetime, not with a guessed identity", () => {
        const { bindings } = fixture();
        const first = bindings.acquire("conversation", "one");
        const scope = first.access().scope;
        first.release();
        expect(() =>
            bindings.acquire("conversation", "two", "copilot-session-id"),
        ).toThrow("resume state is unavailable");
        const second = bindings.acquire(
            "conversation",
            "two",
            first.resumeToken,
        );
        expect(second.access().scope).toBe(scope);
    });

    test("replacing the live Session invalidates old tokens and scope", () => {
        const { bindings, replaceSession } = fixture();
        const first = bindings.acquire("conversation", "one");
        const scope = first.access().scope;
        replaceSession();
        expect(first.access().scope).not.toBe(scope);
        expect(() =>
            bindings.acquire("conversation", "two", first.resumeToken),
        ).toThrow("resume state is unavailable");
        const second = bindings.acquire("conversation", "two");
        expect(second.access().scope).not.toBe(scope);
    });

    test("idle expiry is checked at access and resume, not only when making room", () => {
        const { bindings, advance } = fixture();
        const first = bindings.acquire("conversation", "one");
        advance(STRUCTURED_ACTION_BINDING_IDLE_MS);
        expect(first.access().canDiscoverSchema("list")).toBe(false);
        expect(() =>
            bindings.acquire("conversation", "two", first.resumeToken),
        ).toThrow("resume state is unavailable");
    });

    test("valid use renews idle lifetime", () => {
        const { bindings, advance } = fixture();
        const first = bindings.acquire("conversation", "one");
        advance(STRUCTURED_ACTION_BINDING_IDLE_MS - 1);
        expect(first.access().canDiscoverSchema("list")).toBe(true);
        advance(2);
        expect(first.access().canDiscoverSchema("list")).toBe(true);
    });

    test("capacity never evicts a live binding and expiry frees space", () => {
        const { bindings, advance } = fixture();
        const first = bindings.acquire("conversation", "zero");
        for (let i = 1; i < MAX_STRUCTURED_ACTION_BINDINGS; i++) {
            bindings.acquire("conversation", String(i));
        }
        expect(() => bindings.acquire("conversation", "overflow")).toThrow(
            "capacity reached",
        );
        expect(first.access().canDiscoverSchema("list")).toBe(true);
        const resumed = bindings.acquire(
            "conversation",
            "new",
            first.resumeToken,
        );
        expect(resumed.access().canDiscoverSchema("list")).toBe(true);
        advance(STRUCTURED_ACTION_BINDING_IDLE_MS);
        expect(() =>
            bindings.acquire("conversation", "replacement"),
        ).not.toThrow();
    });

    test("close and a new server registry cannot resume old operations", () => {
        const { bindings } = fixture();
        const first = bindings.acquire("conversation", "one");
        bindings.close();
        expect(first.access().canDiscoverSchema("list")).toBe(false);
        expect(() =>
            bindings.acquire("conversation", "two", first.resumeToken),
        ).toThrow("binding is closed");
        expect(() =>
            fixture().bindings.acquire(
                "conversation",
                "two",
                first.resumeToken,
            ),
        ).toThrow("resume state is unavailable");
    });
});

describe("structured join validation", () => {
    test("legacy joins stay optional; structured joins require explicit conversation", () => {
        expect(() => validateStructuredActionJoin(undefined)).not.toThrow();
        expect(() => validateStructuredActionJoin({})).not.toThrow();
        expect(() =>
            validateStructuredActionJoin({ structuredActions: {} }),
        ).toThrow("explicit target conversationId");
        expect(() =>
            validateStructuredActionJoin({
                conversationId: "conversation",
                structuredActions: {},
            }),
        ).not.toThrow();
    });

    test.each([
        null,
        [],
        "session",
        { resumeToken: 1 },
        { resumeToken: "" },
        { resumeToken: "copilot-session-id" },
        { approved: true },
    ])("rejects malformed structured join options %#", (structuredActions) => {
        const options = {
            conversationId: "conversation",
            structuredActions,
        } as unknown as DispatcherConnectOptions;
        expect(() => validateStructuredActionJoin(options)).toThrow();
    });

    test("validates the resolved target and accepts only the opaque capability shape", () => {
        const options: DispatcherConnectOptions = {
            conversationId: "conversation",
            structuredActions: { resumeToken: "a".repeat(43) },
        };
        expect(() =>
            validateStructuredActionJoin(options, "conversation"),
        ).not.toThrow();
        expect(() =>
            validateStructuredActionJoin(options, "different"),
        ).toThrow("explicit target conversationId");
    });
});
