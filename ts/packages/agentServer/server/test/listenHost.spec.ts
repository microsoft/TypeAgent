// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { resolveAgentServerHost } from "../src/listenHost.js";

const LOOPBACK = "127.0.0.1";

describe("resolveAgentServerHost", () => {
    test("defaults to loopback with no override", () => {
        expect(resolveAgentServerHost(["node", "server.js"], {})).toBe(
            LOOPBACK,
        );
    });

    test("honors --host", () => {
        expect(
            resolveAgentServerHost(
                ["node", "server.js", "--host", "0.0.0.0"],
                {},
            ),
        ).toBe("0.0.0.0");
    });

    test("honors AGENT_SERVER_HOST", () => {
        expect(
            resolveAgentServerHost(["node", "server.js"], {
                AGENT_SERVER_HOST: "0.0.0.0",
            }),
        ).toBe("0.0.0.0");
    });

    test("--host wins over the environment", () => {
        expect(
            resolveAgentServerHost(["node", "server.js", "--host", "::1"], {
                AGENT_SERVER_HOST: "0.0.0.0",
            }),
        ).toBe("::1");
    });

    test("trims surrounding whitespace", () => {
        // An untrimmed value fails to resolve at bind time, yet isLoopbackHost
        // trims before comparing, so it would read as loopback and suppress the
        // exposure warning for a host that never binds.
        expect(
            resolveAgentServerHost(
                ["node", "server.js", "--host", "  localhost  "],
                {},
            ),
        ).toBe("localhost");
        expect(
            resolveAgentServerHost(["node", "server.js"], {
                AGENT_SERVER_HOST: "  0.0.0.0  ",
            }),
        ).toBe("0.0.0.0");
    });

    test("treats a blank --host as absent rather than binding every interface", () => {
        // listen(port, "") binds all interfaces, the opposite of the default.
        expect(
            resolveAgentServerHost(["node", "server.js", "--host", ""], {}),
        ).toBe(LOOPBACK);
        expect(
            resolveAgentServerHost(["node", "server.js", "--host", "   "], {}),
        ).toBe(LOOPBACK);
    });

    test("falls back to the environment when --host has no value", () => {
        expect(
            resolveAgentServerHost(["node", "server.js", "--host"], {
                AGENT_SERVER_HOST: "0.0.0.0",
            }),
        ).toBe("0.0.0.0");
    });

    test("falls back to loopback when --host is the last argument", () => {
        expect(
            resolveAgentServerHost(["node", "server.js", "--host"], {}),
        ).toBe(LOOPBACK);
    });
});
