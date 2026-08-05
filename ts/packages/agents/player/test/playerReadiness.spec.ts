// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for the player agent's checkReadiness env-var probe.
 *
 * The probe re-reads the config files (so a `@config agent refresh` after
 * editing `config.local.yaml` sees the new values) and then reads
 * SPOTIFY_APP_CLI / SPOTIFY_APP_CLISEC / SPOTIFY_APP_PORT from
 * process.env. Each test points the config loader at an empty temp dir
 * and snapshots the relevant vars, so neither the developer's real
 * config.local.yaml nor a previous case bleeds in.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ReadinessReport } from "@typeagent/agent-sdk";

const ENV_KEYS = [
    "SPOTIFY_APP_CLI",
    "SPOTIFY_APP_CLISEC",
    "SPOTIFY_APP_PORT",
] as const;

// Point the config loader at a scratch dir BEFORE the agent module is
// imported: importing it loads config, and the developer's real
// config.local.yaml would otherwise decide the outcome of every case.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "player-readiness-"));
const savedConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
process.env.TYPEAGENT_CONFIG_DIR = configDir;
const localConfigPath = path.join(configDir, "config.local.yaml");

let checkPlayerReadiness: () => Promise<ReadinessReport>;

beforeAll(async () => {
    ({ checkPlayerReadiness } = await import("../src/agent/playerHandlers.js"));
});

afterAll(() => {
    if (savedConfigDir === undefined) delete process.env.TYPEAGENT_CONFIG_DIR;
    else process.env.TYPEAGENT_CONFIG_DIR = savedConfigDir;
    fs.rmSync(configDir, { recursive: true, force: true });
});

describe("checkPlayerReadiness", () => {
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = {};
        for (const k of ENV_KEYS) {
            saved[k] = process.env[k];
            delete process.env[k];
        }
        fs.rmSync(localConfigPath, { force: true });
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
        expect(out.message).toContain("spotify.clientId");
        expect(out.message).not.toContain("spotify.clientSecret");
    });

    test("setup-required when SPOTIFY_APP_CLISEC is missing", async () => {
        process.env.SPOTIFY_APP_CLI = "client";
        process.env.SPOTIFY_APP_PORT = "8080";
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toContain("spotify.clientSecret");
    });

    test("setup-required when SPOTIFY_APP_PORT is missing", async () => {
        process.env.SPOTIFY_APP_CLI = "client";
        process.env.SPOTIFY_APP_CLISEC = "secret";
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toContain("spotify.port");
    });

    test("lists every missing key when more than one is unset", async () => {
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toContain("spotify.clientId");
        expect(out.message).toContain("spotify.clientSecret");
        expect(out.message).toContain("spotify.port");
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
        // Points at the YAML config, not the legacy env vars.
        expect(out.details).toMatch(/config\.local\.yaml/);
        expect(out.details).toMatch(/clientId:/);
        expect(out.details).not.toMatch(/SPOTIFY_APP_/);
    });

    test("picks up values added to config.local.yaml since startup", async () => {
        // The report tells the user to edit config.local.yaml and run
        // `@config agent refresh player`. That only works if the probe
        // re-reads the file: the agent typically runs in a forked child
        // whose process.env was snapshotted before the edit.
        expect((await checkPlayerReadiness()).state).toBe("setup-required");
        fs.writeFileSync(
            localConfigPath,
            "spotify:\n  clientId: id\n  clientSecret: secret\n  port: 8080\n",
        );
        expect((await checkPlayerReadiness()).state).toBe("ready");
    });

    test("picks up a corrected value, not just newly added ones", async () => {
        fs.writeFileSync(
            localConfigPath,
            "spotify:\n  clientId: id\n  clientSecret: secret\n  port: nope\n",
        );
        expect((await checkPlayerReadiness()).state).toBe("setup-required");
        fs.writeFileSync(
            localConfigPath,
            "spotify:\n  clientId: id\n  clientSecret: secret\n  port: 8080\n",
        );
        expect((await checkPlayerReadiness()).state).toBe("ready");
    });

    test("explains an invalid value instead of calling it missing", async () => {
        // A pasted-but-unedited snippet: `port: <value>` is a string, so
        // the typed converter rejects the whole `spotify:` section and the
        // settings look absent. Saying "not configured" sends the user
        // looking for lines that are right there in the file.
        fs.writeFileSync(
            localConfigPath,
            "spotify:\n  clientId: <value>\n  clientSecret: <value>\n  port: <value>\n",
        );
        const out = await checkPlayerReadiness();
        expect(out.state).toBe("setup-required");
        expect(out.message).toMatch(/invalid/i);
        expect(out.message).toContain("spotify.port");
    });
});
