// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ViewProviderRegistry,
    assertViewProviderJson,
    type HostViewProvider,
} from "../src/viewProviders.js";
function provider(): HostViewProvider & { calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        identity: {
            id: "fixture.structured",
            version: "1",
            implementationSha256: "a".repeat(64),
            schemaSha256: "b".repeat(64),
        },
        validateInput() {
            calls.push("input");
        },
        validateDocument() {
            calls.push("document");
        },
        async construct() {
            calls.push("construct");
            return {
                state: "deferred",
                reason: "The selected sources are not ready.",
            };
        },
    };
}

test("provider registration is inert and pins the installed identity", () => {
    const installed = provider();
    const registry = new ViewProviderRegistry([installed]);
    expect(installed.calls).toEqual([]);
    expect(registry.require(installed.identity).identity).toEqual(
        installed.identity,
    );
    expect(Object.isFrozen(registry.require(installed.identity))).toBe(true);
    const copy = registry.identities();
    copy[0].version = "changed";
    expect(registry.identities()[0].version).toBe("1");
});

test("duplicate and invalid providers fail before construction", () => {
    const installed = provider();
    expect(() => new ViewProviderRegistry([installed, provider()])).toThrow(
        "Duplicate",
    );
    for (const changed of [
        { id: "../untrusted" },
        { version: "" },
        { implementationSha256: "changed" },
        { schemaSha256: "changed" },
    ]) {
        const invalid = provider();
        invalid.identity = { ...invalid.identity, ...changed };
        expect(() => new ViewProviderRegistry([invalid])).toThrow(
            "Invalid installed",
        );
        expect(invalid.calls).toEqual([]);
    }
});

test("unknown and changed provider definitions never select a fallback", () => {
    const installed = provider();
    const registry = new ViewProviderRegistry([installed]);
    expect(() =>
        registry.require({
            ...installed.identity,
            id: "fixture.unknown",
        }),
    ).toThrow("Unknown view provider");
    for (const changed of [
        { version: "2" },
        { implementationSha256: "c".repeat(64) },
        { schemaSha256: "d".repeat(64) },
    ])
        expect(() =>
            registry.require({ ...installed.identity, ...changed }),
        ).toThrow("identity changed");
    expect(installed.calls).toEqual([]);
});

test("data-only provider JSON survives detached clones and enforces exact depth", () => {
    expect(() =>
        assertViewProviderJson(
            structuredClone({
                heading: "What happened?",
                values: [true, null, 2],
            }),
        ),
    ).not.toThrow();
    function nested(levels: number): object {
        let value: object = {};
        for (let i = 1; i < levels; i++) value = { child: value };
        return value;
    }
    expect(() => assertViewProviderJson(nested(64))).not.toThrow();
    expect(() => assertViewProviderJson(nested(65))).toThrow(
        "64 object levels",
    );
    for (const invalid of [
        { value: Number.NaN },
        { value: Number.POSITIVE_INFINITY },
        { value: undefined },
        { value: () => true },
        new Date(),
        new Array(1),
    ])
        expect(() => assertViewProviderJson(invalid)).toThrow(
            "finite, acyclic JSON",
        );
    const circular: { child?: object } = {};
    circular.child = circular;
    expect(() => assertViewProviderJson(circular)).toThrow(
        "finite, acyclic JSON",
    );
});
