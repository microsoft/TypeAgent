// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    inboxCounts,
    inboxItems,
    isHidden,
    parseRoute,
    readHidden,
    routeHash,
} from "./memoryHubModel";
import type { MemoryHubInboxItem } from "@typeagent/browser-control-rpc/viewRpc";

function item(
    id: string,
    overrides: Partial<MemoryHubInboxItem> = {},
): MemoryHubInboxItem {
    return {
        id,
        fingerprint: `${id}:v1`,
        kind: "candidate",
        corpusId: "a",
        corpusName: "A",
        objectId: id,
        title: id,
        reason: "Review",
        updatedAt: "2026-10-01T00:00:00Z",
        severity: "info",
        ...overrides,
    };
}

test("deep links round-trip reserved characters without losing identity", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const source = {
        page: "library" as const,
        corpusId: "corpus/a",
        objectId: "source:# ?/1",
    };
    expect(parseRoute(routeHash(source))).toEqual(source);
    const inbox = { page: "inbox" as const, objectId: "candidate:c/a" };
    expect(parseRoute(routeHash(inbox))).toEqual(inbox);
    expect(parseRoute("#/unknown")).toEqual({
        page: "inbox",
        objectId: undefined,
    });
    expect(parseRoute("#/library/%invalid")).toEqual({
        page: "library",
        corpusId: undefined,
        objectId: undefined,
    });
    expect(warn).toHaveBeenCalledWith(
        "Invalid Memory deep-link encoding.",
        expect.any(URIError),
    );
    warn.mockRestore();
});

test("dismiss and snooze are fingerprint-specific, reversible and expire", () => {
    const first = item("first");
    const hidden = {
        first: { fingerprint: first.fingerprint },
        second: { fingerprint: "second:v1", until: 100 },
    };
    expect(isHidden(first, hidden, 99)).toBe(true);
    expect(
        isHidden(item("first", { fingerprint: "first:v2" }), hidden, 99),
    ).toBe(false);
    expect(isHidden(item("second"), hidden, 99)).toBe(true);
    expect(isHidden(item("second"), hidden, 100)).toBe(false);
    delete hidden.first;
    expect(isHidden(first, hidden)).toBe(false);
});

test("browser-only exploration routes retain exact graph selections without pretending to select a corpus", () => {
    for (const route of [
        { page: "explore" as const, webView: "analytics" as const },
        {
            page: "explore" as const,
            webView: "entities" as const,
            webEntity: "Worker / A&B #1",
        },
        {
            page: "explore" as const,
            webView: "topics" as const,
            webTopic: "Deploy / verify",
        },
    ]) {
        const parsed = parseRoute(routeHash(route));
        expect(parsed).toEqual(route);
        expect(parsed.corpusId).toBeUndefined();
    }
});

test("Runbook deep links preserve candidate kind, exact history version and skill revision", () => {
    for (const route of [
        {
            page: "runbooks" as const,
            corpusId: "corpus/a",
            objectId: "candidate/id",
            runbookKind: "candidate" as const,
        },
        {
            page: "runbooks" as const,
            corpusId: "a",
            objectId: "p",
            runbookKind: "procedure" as const,
            procedureVersion: 4,
        },
        {
            page: "runbooks" as const,
            corpusId: "a",
            objectId: "p",
            runbookKind: "procedure" as const,
            skillRevisionId: "revision:old/1",
        },
    ])
        expect(parseRoute(routeHash(route))).toEqual(route);
    expect(
        parseRoute("#/runbooks/a/p/procedure/0").procedureVersion,
    ).toBeUndefined();
    expect(
        parseRoute("#/runbooks/a/p/procedure/9007199254740992")
            .procedureVersion,
    ).toBeUndefined();
});

test("complete Inbox counts apply hides while Activity counts actual scoped failed jobs independently", () => {
    const items = Array.from({ length: 52 }, (_, index) => item(String(index)));
    items.push(
        item("failed", {
            kind: "job",
            severity: "attention",
            jobState: "failed",
            title: "partial-looking title",
            fingerprint: "opaque",
        }),
        item("partial", {
            kind: "job",
            severity: "attention",
            jobState: "partial",
            title: "failed-looking title",
        }),
    );
    expect(inboxCounts(items, {}, undefined, 0)).toEqual({
        inbox: 54,
        failedJobs: 1,
    });
    expect(
        inboxCounts(items, { failed: { fingerprint: "opaque" } }, undefined, 0),
    ).toEqual({ inbox: 53, failedJobs: 1 });
    expect(
        inboxCounts(
            items,
            { failed: { fingerprint: "opaque", until: 100 } },
            undefined,
            0,
        ),
    ).toEqual({ inbox: 53, failedJobs: 1 });
    expect(inboxCounts(items, {}, "other", 0)).toEqual({
        inbox: 0,
        failedJobs: 0,
    });
    expect(inboxItems(items, {})[0].id).toBe("failed");
});

test("grouping, corpus/kind filters and dismissed view combine deterministically", () => {
    const items = [
        item("b", { corpusId: "b", corpusName: "B" }),
        item("a"),
        item("stale", { kind: "staleProcedure", severity: "attention" }),
    ];
    const hidden = { a: { fingerprint: "a:v1" } };
    expect(
        inboxItems(items, hidden, { corpusId: "a" }).map((value) => value.id),
    ).toEqual(["stale"]);
    expect(
        inboxItems(items, hidden, { dismissed: true }).map((value) => value.id),
    ).toEqual(["a"]);
    expect(
        inboxItems(items, {}, { kind: "candidate", group: "corpus" }).map(
            (value) => value.id,
        ),
    ).toEqual(["a", "b"]);
});

test("corrupt local preferences cannot hide records", () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(readHidden("not JSON")).toEqual({});
    expect(
        readHidden(
            '{"x":{"fingerprint":2},"y":{"fingerprint":"y","until":"forever"}}',
        ),
    ).toEqual({});
    expect(readHidden('{"x":{"fingerprint":"v"}}')).toEqual({
        x: { fingerprint: "v" },
    });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
});
