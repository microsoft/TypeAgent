// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { jest } from "@jest/globals";
import { inspect } from "node:util";
import {
    SessionWatcher,
    type ApprovedSessionUpdate,
    type ApprovedUpdateDestination,
    type NormalizedSessionUpdate,
    type SessionPrivacyFilter,
} from "../src/sessionWatcher.js";

const secret = "sensitive-payload";

function makeUpdate(value = secret): NormalizedSessionUpdate {
    return {
        projectPath: `C:\\${value}`,
        sessionId: value,
        events: [
            {
                id: `${value}-1`,
                sourceEventId: `${value}-1`,
                timestamp: value,
                model: value,
                type: "message",
                role: "user",
                text: value,
            },
            {
                id: `${value}-2`,
                type: "message",
                role: "agent",
                text: value,
            },
            {
                id: `${value}-3`,
                type: "message",
                role: "system",
                text: value,
            },
            {
                id: `${value}-4`,
                type: "tool-start",
                toolCallId: value,
                toolName: value,
                arguments: { command: value, nested: { path: value } },
            },
            {
                id: `${value}-5`,
                type: "tool-complete",
                toolCallId: value,
                success: true,
                output: value,
                diff: value,
            },
            {
                id: `${value}-6`,
                type: "session",
                eventType: value,
                details: { nested: { path: value } },
            },
        ],
        metadata: {
            clientName: value,
            models: [value],
            parentSessionId: value,
            startedAt: value,
            lastEventTimestamp: value,
        },
    };
}

async function approve(
    watcher: SessionWatcher,
    update = makeUpdate(),
): Promise<ApprovedSessionUpdate> {
    const handle = await watcher.filterForPrivacy(update);
    if (handle === null) {
        throw new Error("Expected an approval");
    }
    return handle;
}

async function expectSafeError(
    operation: Promise<unknown>,
    message: string,
): Promise<void> {
    let caught: unknown;
    try {
        await operation;
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).toHaveProperty("message", message);
    expect(caught).not.toHaveProperty("cause");
    expect(inspect(caught)).not.toContain(secret);
    expect(JSON.stringify(caught)).not.toContain(secret);
}

test("missing privacy filter fails closed", async () => {
    const destination = jest.fn<ApprovedUpdateDestination>();
    const watcher = new SessionWatcher({
        approvedUpdateDestination: destination,
    });
    await expectSafeError(
        watcher.filterForPrivacy(makeUpdate()),
        "SessionWatcher privacy filter is not configured",
    );
    expect(destination).not.toHaveBeenCalled();
});

test("missing destination rejects an approved handoff", async () => {
    const watcher = new SessionWatcher({ privacyFilter: (update) => update });
    const handle = await approve(watcher);
    await expectSafeError(
        watcher.publishUpdate(handle),
        "SessionWatcher approved-update destination is not configured",
    );
});

test("approval inspects the entire update and only publishes explicitly", async () => {
    const update = makeUpdate();
    const filter = jest.fn<SessionPrivacyFilter>((input) => input);
    const destination = jest.fn<ApprovedUpdateDestination>();
    const watcher = new SessionWatcher({
        privacyFilter: filter,
        approvedUpdateDestination: destination,
    });
    const handle = await approve(watcher, update);
    const inspected = filter.mock.calls[0][0];
    expect(inspected).toEqual(update);
    expect(inspected).not.toBe(update);
    expect(inspected.events).not.toBe(update.events);
    expect(inspected.metadata.models).not.toBe(update.metadata.models);
    expect(destination).not.toHaveBeenCalled();
    expect(JSON.stringify(handle)).toBe("{}");
    expect(Object.isFrozen(handle)).toBe(true);

    await watcher.publishUpdate(handle);
    expect(destination).toHaveBeenCalledTimes(1);
    expect(destination).toHaveBeenCalledWith(update);
    expect(destination.mock.calls[0][0]).not.toBe(inspected);
});

test("redaction replaces events, paths, identity and metadata before delivery", async () => {
    const raw = makeUpdate();
    const redacted = makeUpdate("[redacted]");
    const destination = jest.fn<ApprovedUpdateDestination>();
    const watcher = new SessionWatcher({
        privacyFilter: async (input) => {
            expect(input).toEqual(raw);
            return redacted;
        },
        approvedUpdateDestination: destination,
    });
    const handle = await approve(watcher, raw);
    await watcher.publishUpdate(handle);
    expect(destination).toHaveBeenCalledWith(redacted);
    expect(JSON.stringify(destination.mock.calls)).not.toContain(secret);
    expect(raw).toEqual(makeUpdate());
});

test("deliberate exclusion produces no handle and sends nothing", async () => {
    const destination = jest.fn<ApprovedUpdateDestination>();
    const watcher = new SessionWatcher({
        privacyFilter: async () => null,
        approvedUpdateDestination: destination,
    });
    const approved = await watcher.filterForPrivacy(makeUpdate());
    if (approved !== null) {
        await watcher.publishUpdate(approved);
    }
    expect(approved).toBeNull();
    expect(destination).not.toHaveBeenCalled();
});

test.each<SessionPrivacyFilter>([
    () => {
        throw new Error(secret);
    },
    async () => {
        throw { message: secret, payload: makeUpdate() };
    },
])(
    "filter failure is sanitized and sends nothing (%#)",
    async (privacyFilter) => {
        const destination = jest.fn<ApprovedUpdateDestination>();
        const watcher = new SessionWatcher({
            privacyFilter,
            approvedUpdateDestination: destination,
        });
        await expectSafeError(
            watcher.filterForPrivacy(makeUpdate()),
            "SessionWatcher privacy filtering failed",
        );
        expect(destination).not.toHaveBeenCalled();
    },
);

test.each([undefined, false, secret, {}, { events: [] }])(
    "invalid filter result is not treated as exclusion (%#)",
    async (result) => {
        const destination = jest.fn<ApprovedUpdateDestination>();
        const watcher = new SessionWatcher({
            // @ts-expect-error Exercise a misconfigured JavaScript dependency.
            privacyFilter: () => result,
            approvedUpdateDestination: destination,
        });
        await expectSafeError(
            watcher.filterForPrivacy(makeUpdate()),
            "SessionWatcher privacy filter returned an invalid update",
        );
        expect(destination).not.toHaveBeenCalled();
    },
);

test.each(["input", "result"] as const)(
    "uncloneable %s fails with a sanitized snapshot error",
    async (stage) => {
        const uncloneable = makeUpdate();
        uncloneable.events.push({
            id: "uncloneable",
            type: "tool-start",
            toolCallId: "call",
            toolName: "tool",
            arguments: () => secret,
        });
        const filter = jest.fn<SessionPrivacyFilter>(() => uncloneable);
        const destination = jest.fn<ApprovedUpdateDestination>();
        const watcher = new SessionWatcher({
            privacyFilter: filter,
            approvedUpdateDestination: destination,
        });
        await expectSafeError(
            watcher.filterForPrivacy(
                stage === "input" ? uncloneable : makeUpdate(),
            ),
            "SessionWatcher update snapshot failed",
        );
        expect(filter).toHaveBeenCalledTimes(stage === "input" ? 0 : 1);
        expect(destination).not.toHaveBeenCalled();
    },
);

test("shared backing memory is rejected instead of leaking mutable approved data", async () => {
    const shared = new SharedArrayBuffer(4);
    const update = makeUpdate();
    update.events.push({
        id: "shared",
        type: "tool-start",
        toolCallId: "call",
        toolName: "tool",
        arguments: { nested: { shared } },
    });
    const destination = jest.fn<ApprovedUpdateDestination>();
    const watcher = new SessionWatcher({
        privacyFilter: () => update,
        approvedUpdateDestination: destination,
    });
    await expectSafeError(
        watcher.filterForPrivacy(makeUpdate()),
        "SessionWatcher update snapshot failed",
    );
    expect(destination).not.toHaveBeenCalled();
});

test.each<ApprovedUpdateDestination>([
    () => {
        throw new Error(secret);
    },
    async () => {
        throw { message: secret, payload: makeUpdate() };
    },
])(
    "destination failure surfaces without payload or cause (%#)",
    async (destination) => {
        const watcher = new SessionWatcher({
            privacyFilter: () => makeUpdate("[redacted]"),
            approvedUpdateDestination: destination,
        });
        const handle = await approve(watcher);
        await expectSafeError(
            watcher.publishUpdate(handle),
            "SessionWatcher approved-update delivery failed",
        );
    },
);

test("raw, copied, forged and foreign handles cannot bypass approval", async () => {
    const destination = jest.fn<ApprovedUpdateDestination>();
    const watcher = new SessionWatcher({
        privacyFilter: (update) => update,
        approvedUpdateDestination: destination,
    });
    const foreign = new SessionWatcher({ privacyFilter: (update) => update });
    const handle = await approve(watcher);
    const invalidHandles: unknown[] = [
        makeUpdate(),
        {},
        null,
        undefined,
        secret,
        { ...handle },
        Object.create(handle),
        await approve(foreign),
    ];
    for (const invalid of invalidHandles) {
        await expectSafeError(
            // @ts-expect-error Runtime callers cannot authorize data via a cast.
            watcher.publishUpdate(invalid),
            "SessionWatcher update is not approved by this watcher",
        );
    }
    expect(destination).not.toHaveBeenCalled();
});

test("filter mutations and retained references cannot change caller or approval", async () => {
    const raw = makeUpdate();
    const original = structuredClone(raw);
    const retained: NormalizedSessionUpdate[] = [];
    const destination = jest.fn<ApprovedUpdateDestination>();
    const watcher = new SessionWatcher({
        privacyFilter: (input) => {
            input.metadata.models.push("filtered-model");
            input.events.splice(0, 1);
            retained.push(input);
            return input;
        },
        approvedUpdateDestination: destination,
    });
    const pending = watcher.filterForPrivacy(raw);
    raw.metadata.models.push("caller mutation during filtering");
    const handle = await pending;
    expect(handle).not.toBeNull();
    const expected = structuredClone(retained[0]);
    retained[0].metadata.models.push("filter mutation after approval");
    retained[0].events.length = 0;
    raw.events.length = 0;
    if (handle !== null) {
        await watcher.publishUpdate(handle);
    }
    expect(destination).toHaveBeenCalledWith(expected);
    expect(raw.metadata.models).toEqual([
        ...original.metadata.models,
        "caller mutation during filtering",
    ]);
});

test("retained redacted results and destination mutations leave approval unchanged", async () => {
    const redacted = makeUpdate("[redacted]");
    const expected = structuredClone(redacted);
    const delivered: NormalizedSessionUpdate[] = [];
    const watcher = new SessionWatcher({
        privacyFilter: () => redacted,
        approvedUpdateDestination: (update) => {
            delivered.push(structuredClone(update));
            update.metadata.models.push(secret);
            update.events.length = 0;
            if (delivered.length === 1) {
                throw new Error(secret);
            }
        },
    });
    const handle = await approve(watcher);
    redacted.metadata.models.push(secret);
    redacted.events.length = 0;
    await expectSafeError(
        watcher.publishUpdate(handle),
        "SessionWatcher approved-update delivery failed",
    );
    await watcher.publishUpdate(handle);
    expect(delivered).toEqual([expected, expected]);
});

test("metadata-only updates are handed off and destination acceptance is awaited", async () => {
    let accept: (() => void) | undefined;
    const accepted = new Promise<void>((resolve) => {
        accept = resolve;
    });
    const update = makeUpdate();
    update.events = [];
    const destination = jest.fn<ApprovedUpdateDestination>(() => accepted);
    const watcher = new SessionWatcher({
        privacyFilter: (input) => input,
        approvedUpdateDestination: destination,
    });
    const handle = await approve(watcher, update);
    let finished = false;
    const publication = watcher.publishUpdate(handle).then(() => {
        finished = true;
    });
    await Promise.resolve();
    expect(destination).toHaveBeenCalledWith(update);
    expect(finished).toBe(false);
    accept?.();
    await publication;
    expect(finished).toBe(true);
});
