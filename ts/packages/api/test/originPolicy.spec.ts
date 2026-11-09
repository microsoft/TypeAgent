// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    createOriginAllowlist,
    isAllowedApiOrigin,
    parseAllowedOrigins,
    resolveCorsOrigin,
} from "../src/originPolicy.js";

function buildAllowlist(configured?: string) {
    return createOriginAllowlist(parseAllowedOrigins(configured));
}

describe("createOriginAllowlist", () => {
    test("allows the loopback origins the chat view is served from", () => {
        const isAllowed = buildAllowlist();
        expect(isAllowed("http://localhost:3000")).toBe(true);
        expect(isAllowed("http://127.0.0.1:3000")).toBe(true);
        expect(isAllowed("https://[::1]:3443")).toBe(true);
    });

    test("allows a missing Origin so non-browser callers still work", () => {
        expect(buildAllowlist()(undefined)).toBe(true);
    });

    test("refuses the opaque origin a sandboxed iframe sends", () => {
        expect(buildAllowlist()("null")).toBe(false);
    });

    test("refuses an arbitrary site", () => {
        expect(buildAllowlist()("https://evil.example.com")).toBe(false);
    });

    test("allows an operator-configured hosted origin", () => {
        const isAllowed = buildAllowlist("https://typeagent.example.com");
        expect(isAllowed("https://typeagent.example.com")).toBe(true);
    });

    test("configuring one origin does not open up others", () => {
        const isAllowed = buildAllowlist("https://typeagent.example.com");
        expect(isAllowed("https://evil.example.com")).toBe(false);
        // A DNS rebinding attacker reaches the port but still sends its own
        // domain as Origin, so naming a hosted origin does not admit it.
        expect(isAllowed("http://rebind.example.com")).toBe(false);
    });

    test("accepts a list and tolerates spacing and a trailing slash", () => {
        const isAllowed = buildAllowlist(
            " https://a.example.com/ , https://b.example.com ",
        );
        expect(isAllowed("https://a.example.com")).toBe(true);
        expect(isAllowed("https://b.example.com")).toBe(true);
        expect(isAllowed("https://c.example.com")).toBe(false);
    });

    test("a port mismatch on a configured origin is still refused", () => {
        const isAllowed = buildAllowlist("https://typeagent.example.com");
        expect(isAllowed("https://typeagent.example.com:8443")).toBe(false);
    });

    test("refuses ambiguous repeated Origin headers", () => {
        const isAllowed = buildAllowlist("https://typeagent.example.com");
        expect(
            isAllowed(["https://typeagent.example.com", "https://evil.test"]),
        ).toBe(false);
    });
});

describe("parseAllowedOrigins", () => {
    test("returns nothing when unset", () => {
        expect(parseAllowedOrigins(undefined)).toEqual([]);
    });

    test("drops entries that aren't absolute http(s) origins", () => {
        expect(
            parseAllowedOrigins(
                "https://ok.example.com, not-a-url, ftp://x.example.com, ,",
            ),
        ).toEqual(["https://ok.example.com"]);
    });
});

describe("isAllowedApiOrigin", () => {
    const ENV = "TYPEAGENT_API_ALLOWED_ORIGINS";

    afterEach(() => {
        delete process.env[ENV];
    });

    test("reads the environment per call, not once at import", () => {
        // Startup merges YAML and Key Vault config into process.env after
        // this module is imported, so a value that appears later still has
        // to take effect.
        delete process.env[ENV];
        expect(isAllowedApiOrigin("https://late.example.com")).toBe(false);

        process.env[ENV] = "https://late.example.com";
        expect(isAllowedApiOrigin("https://late.example.com")).toBe(true);
    });

    test("stops honoring an origin once it is removed", () => {
        process.env[ENV] = "https://late.example.com";
        expect(isAllowedApiOrigin("https://late.example.com")).toBe(true);

        delete process.env[ENV];
        expect(isAllowedApiOrigin("https://late.example.com")).toBe(false);
    });

    test("keeps the loopback baseline regardless of configuration", () => {
        delete process.env[ENV];
        expect(isAllowedApiOrigin("http://127.0.0.1:3000")).toBe(true);
        expect(isAllowedApiOrigin("null")).toBe(false);
    });
});

describe("resolveCorsOrigin", () => {
    const ENV = "TYPEAGENT_API_ALLOWED_ORIGINS";
    const saved = process.env[ENV];

    afterEach(() => {
        if (saved === undefined) {
            delete process.env[ENV];
        } else {
            process.env[ENV] = saved;
        }
    });

    test("sends no CORS header when the request has no Origin", () => {
        delete process.env[ENV];
        // Same-origin loads of the chat view need no header, and answering
        // them with a wildcard would hand every other site read access.
        expect(resolveCorsOrigin(undefined)).toBeUndefined();
    });

    test("refuses to echo an arbitrary site", () => {
        delete process.env[ENV];
        expect(resolveCorsOrigin("https://evil.example.com")).toBeUndefined();
    });

    test("refuses to echo the opaque origin", () => {
        delete process.env[ENV];
        expect(resolveCorsOrigin("null")).toBeUndefined();
    });

    test("echoes an operator configured origin", () => {
        process.env[ENV] = "https://typeagent.example.com";
        expect(resolveCorsOrigin("https://typeagent.example.com")).toBe(
            "https://typeagent.example.com",
        );
    });

    test("echoes the loopback origins the chat view is served from", () => {
        delete process.env[ENV];
        expect(resolveCorsOrigin("http://localhost:3000")).toBe(
            "http://localhost:3000",
        );
    });

    test("echoes the normalized origin, never the raw header", () => {
        process.env[ENV] = "https://typeagent.example.com";
        // A trailing path or odd casing must not reach the response header.
        expect(resolveCorsOrigin("https://TypeAgent.Example.com/")).toBe(
            "https://typeagent.example.com",
        );
    });

    test("refuses a header that repeats, which cannot be a real origin", () => {
        delete process.env[ENV];
        expect(
            resolveCorsOrigin(["http://localhost:3000", "https://evil.test"]),
        ).toBeUndefined();
    });
});
