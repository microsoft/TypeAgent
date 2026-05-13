// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the player agent's checkReadiness env-var probe.
 *
 * The probe reads SPOTIFY_APP_CLI / SPOTIFY_APP_CLISEC / SPOTIFY_APP_PORT
 * from process.env. Each test snapshots and restores the relevant vars so
 * the test harness's actual .env (which may or may not be configured)
 * doesn't bleed across cases.
 */

import { checkPlayerReadiness } from "../src/agent/playerHandlers.js";

const ENV_KEYS = [
    "SPOTIFY_APP_CLI",
    "SPOTIFY_APP_CLISEC",
    "SPOTIFY_APP_PORT",
] as const;

describe("checkPlayerReadiness", () => {
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = {};
        for (const k of ENV_KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    test("ready when all three vars are set with a valid port", async () => {
        process.env.SPOTIFY_APP_CLI = "client";
        process.env.SPOTIFY_APP_CLISEC = "secret";
        process.env.SPOTIFY_APP_PORT = "8080";
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("ready");
    });

    test("setup-required when SPOTIFY_APP_CLI is missing", async () => {
        process.env.SPOTIFY_APP_CLISEC = "secret";
        process.env.SPOTIFY_APP_PORT = "8080";
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toContain("SPOTIFY_APP_CLI");
        expect(out.message).not.toContain("SPOTIFY_APP_CLISEC,");
    });

    test("setup-required when SPOTIFY_APP_CLISEC is missing", async () => {
        process.env.SPOTIFY_APP_CLI = "client";
        process.env.SPOTIFY_APP_PORT = "8080";
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toContain("SPOTIFY_APP_CLISEC");
    });

    test("setup-required when SPOTIFY_APP_PORT is missing", async () => {
        process.env.SPOTIFY_APP_CLI = "client";
        process.env.SPOTIFY_APP_CLISEC = "secret";
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toContain("SPOTIFY_APP_PORT");
    });

    test("lists every missing var when more than one is unset", async () => {
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toContain("SPOTIFY_APP_CLI");
        expect(out.message).toContain("SPOTIFY_APP_CLISEC");
        expect(out.message).toContain("SPOTIFY_APP_PORT");
    });

    test("setup-required with port-specific message when SPOTIFY_APP_PORT isn't a number", async () => {
        process.env.SPOTIFY_APP_CLI = "client";
        process.env.SPOTIFY_APP_CLISEC = "secret";
        process.env.SPOTIFY_APP_PORT = "not-a-port";
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toMatch(/invalid port number/i);
        expect(out.message).toContain("not-a-port");
    });

    test("port with leading zeros is rejected (parseInt round-trip mismatch)", async () => {
        process.env.SPOTIFY_APP_CLI = "client";
        process.env.SPOTIFY_APP_CLISEC = "secret";
        process.env.SPOTIFY_APP_PORT = "08080";
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toMatch(/invalid port number/i);
    });

    test("includes 'details' on the setup-required report so users know where to look", async () => {
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.details).toBeTruthy();
        expect(out.details).toMatch(/ts\/\.env/);
    });
});
