// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    isTrustedActionRequest,
    resolveListenHost,
    type TypeAgentAPIServerConfig,
} from "../src/webServer.js";
import { isLoopbackHost } from "@typeagent/websocket-utils/loopback";

const baseConfig: TypeAgentAPIServerConfig = {
    wwwroot: "../shell/out/renderer",
    port: 3000,
    broadcast: true,
    blobBackupEnabled: false,
};

afterEach(() => {
    delete process.env.TYPEAGENT_API_HOST;
});

describe("resolveListenHost", () => {
    test("defaults to loopback so a local run isn't on the network", () => {
        expect(resolveListenHost(baseConfig)).toBe("127.0.0.1");
    });

    test("honors a configured host", () => {
        expect(resolveListenHost({ ...baseConfig, host: "0.0.0.0" })).toBe(
            "0.0.0.0",
        );
    });

    test("TYPEAGENT_API_HOST wins over the config file", () => {
        process.env.TYPEAGENT_API_HOST = "0.0.0.0";
        expect(resolveListenHost({ ...baseConfig, host: "127.0.0.1" })).toBe(
            "0.0.0.0",
        );
    });

    test("ignores a blank override", () => {
        process.env.TYPEAGENT_API_HOST = "   ";
        expect(resolveListenHost(baseConfig)).toBe("127.0.0.1");
    });
});

describe("isTrustedActionRequest", () => {
    test("allows non-browser clients that send neither header", () => {
        expect(isTrustedActionRequest({})).toBe(true);
    });

    test("allows the chat view this server serves", () => {
        expect(
            isTrustedActionRequest({
                origin: "http://localhost:3000",
                "sec-fetch-site": "same-origin",
            }),
        ).toBe(true);
    });

    test("allows a URL the user typed", () => {
        expect(isTrustedActionRequest({ "sec-fetch-site": "none" })).toBe(true);
    });

    test("rejects a cross-origin fetch", () => {
        expect(
            isTrustedActionRequest({
                origin: "https://evil.example.com",
                "sec-fetch-site": "cross-site",
            }),
        ).toBe(false);
    });

    test("rejects an img-tag request that carries no Origin", () => {
        // <img src="http://localhost:3000/action/?a=..."> on an attacker page:
        // no Origin header, but browsers still label the fetch cross-site.
        expect(isTrustedActionRequest({ "sec-fetch-site": "cross-site" })).toBe(
            false,
        );
    });

    test("rejects another page on a different loopback port", () => {
        // Ports don't distinguish sites, so a malicious page served from
        // another local port is same-site, not same-origin.
        expect(
            isTrustedActionRequest({
                origin: "http://localhost:5173",
                "sec-fetch-site": "same-site",
            }),
        ).toBe(false);
    });

    test("rejects an opaque origin", () => {
        expect(isTrustedActionRequest({ origin: "null" })).toBe(false);
    });
});

describe("isLoopbackHost", () => {
    test("recognizes the loopback forms a listener can bind", () => {
        expect(isLoopbackHost("127.0.0.1")).toBe(true);
        expect(isLoopbackHost("127.1.2.3")).toBe(true);
        expect(isLoopbackHost("localhost")).toBe(true);
        expect(isLoopbackHost("::1")).toBe(true);
        expect(isLoopbackHost("[::1]")).toBe(true);
        expect(isLoopbackHost(" LocalHost ")).toBe(true);
    });

    test("treats a public bind as exposed so the warning still fires", () => {
        expect(isLoopbackHost("0.0.0.0")).toBe(false);
        expect(isLoopbackHost("192.168.1.10")).toBe(false);
        expect(isLoopbackHost("::")).toBe(false);
    });

    test("a hostname that merely starts with 127. is not loopback", () => {
        // Node resolves these through DNS, so they can land on a public or
        // wildcard address. Accepting them would silence the exposure warning.
        expect(isLoopbackHost("127.example.com")).toBe(false);
        expect(isLoopbackHost("127.0.0.1.evil.test")).toBe(false);
        expect(isLoopbackHost("127.0.0")).toBe(false);
        expect(isLoopbackHost("1270.0.0.1")).toBe(false);
    });
});
