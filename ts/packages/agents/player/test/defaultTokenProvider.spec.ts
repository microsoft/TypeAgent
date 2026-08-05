// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Tests for createTokenProvider's config handling.
 *
 * Agent processes are forked with a snapshot of process.env, so the token
 * provider has to re-read the config files at call time rather than trust
 * values captured when the module was first imported — otherwise settings
 * the user added after startup (and confirmed with `@config agent refresh
 * player`) stay invisible to `@player spotify login`.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const ENV_KEYS = [
    "SPOTIFY_APP_CLI",
    "SPOTIFY_APP_CLISEC",
    "SPOTIFY_APP_PORT",
] as const;

// Set before the module is imported: importing it loads config, and the
// developer's real config.local.yaml would otherwise leak into the results.
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "player-token-"));
const savedConfigDir = process.env.TYPEAGENT_CONFIG_DIR;
process.env.TYPEAGENT_CONFIG_DIR = configDir;
const localConfigPath = path.join(configDir, "config.local.yaml");

let createTokenProvider: (storage?: any) => Promise<unknown>;

beforeAll(async () => {
    ({ createTokenProvider } = await import("../src/defaultTokenProvider.js"));
});

afterAll(() => {
    if (savedConfigDir === undefined) delete process.env.TYPEAGENT_CONFIG_DIR;
    else process.env.TYPEAGENT_CONFIG_DIR = savedConfigDir;
    fs.rmSync(configDir, { recursive: true, force: true });
});

describe("createTokenProvider", () => {
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

    test("reports missing settings with a pasteable markdown hint", async () => {
        const e: any = await createTokenProvider().then(
            () => undefined,
            (e) => e,
        );
        expect(e.message).toContain("spotify.clientId");
        // The one-line summary stays plain; the snippet lives in markdown.
        expect(e.message).not.toContain("```");
        expect(e.markdown).toContain("```yaml");
        expect(e.markdown).toContain("clientId");
    });

    test("picks up values added to config.local.yaml since startup", async () => {
        fs.writeFileSync(
            localConfigPath,
            [
                "spotify:",
                "  clientId: id",
                "  clientSecret: secret",
                "  port: 8080",
                "",
            ].join("\n"),
        );
        await expect(createTokenProvider()).resolves.toBeDefined();
    });

    test("explains a non-numeric port instead of failing obscurely", async () => {
        fs.writeFileSync(
            localConfigPath,
            ["spotify:", "  clientId: id", "  clientSecret: secret", ""].join(
                "\n",
            ),
        );
        process.env.SPOTIFY_APP_PORT = "not-a-port";
        const e: any = await createTokenProvider().then(
            () => undefined,
            (e) => e,
        );
        expect(e.message).toContain("invalid port number");
        expect(e.markdown).toContain("```yaml");
    });
});
