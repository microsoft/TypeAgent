// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "node:fs";
import {
    clearTokenCacheForTest,
    FeedAuthError,
    getFeedAccessToken,
    writeTransientNpmAuth,
    removeTransientNpmAuth,
} from "../src/installSources/feedAuth.js";

const REGISTRY =
    "https://pkgs.dev.azure.com/myorg/myproject/_packaging/typeagent/npm/registry/";

function azOutput(token: string, expiresInMs: number): string {
    return JSON.stringify({
        accessToken: token,
        expiresOn: new Date(Date.now() + expiresInMs).toISOString(),
    });
}

beforeEach(() => clearTokenCacheForTest());

describe("feedAuth.getFeedAccessToken", () => {
    it("reuses a cached token until ~60s before expiry", async () => {
        let calls = 0;
        const runner = async () => {
            calls++;
            return azOutput(`token-${calls}`, 70_000); // > 60s grace
        };
        const a = await getFeedAccessToken(runner);
        const b = await getFeedAccessToken(runner);
        expect(a).toBe("token-1");
        expect(b).toBe("token-1"); // reused
        expect(calls).toBe(1);
    });

    it("re-mints when the cached token is within the 60s grace window", async () => {
        let calls = 0;
        const runner = async () => {
            calls++;
            return azOutput(`token-${calls}`, 50_000); // < 60s grace
        };
        const a = await getFeedAccessToken(runner);
        const b = await getFeedAccessToken(runner);
        expect(a).toBe("token-1");
        expect(b).toBe("token-2"); // re-minted
        expect(calls).toBe(2);
    });

    it("throws FeedAuthError when az output has no accessToken", async () => {
        await expect(
            getFeedAccessToken(async () =>
                JSON.stringify({ expiresOn: new Date().toISOString() }),
            ),
        ).rejects.toThrow(FeedAuthError);
    });

    it("throws FeedAuthError on unparseable az output", async () => {
        await expect(
            getFeedAccessToken(async () => "not-json"),
        ).rejects.toThrow(/Unexpected/);
    });

    it("propagates an actionable az login hint from the runner", async () => {
        await expect(
            getFeedAccessToken(async () => {
                throw new FeedAuthError(
                    "Could not get an Azure DevOps access token. Run 'az login' and try again.",
                );
            }),
        ).rejects.toThrow(/az login/);
    });
});

describe("feedAuth transient npm auth", () => {
    it("writes a .npmrc carrying the bearer token and removes it", async () => {
        const runner = async () => azOutput("secret-token", 3600_000);
        const file = await writeTransientNpmAuth(REGISTRY, runner);
        try {
            const contents = fs.readFileSync(file, "utf8");
            expect(contents).toContain("_authToken=secret-token");
            expect(contents).toContain("always-auth=true");
            // mode 0o600 on POSIX.
            if (process.platform !== "win32") {
                const mode = fs.statSync(file).mode & 0o777;
                expect(mode).toBe(0o600);
            }
        } finally {
            removeTransientNpmAuth(file);
        }
        expect(fs.existsSync(file)).toBe(false);
    });

    it("removeTransientNpmAuth is best-effort (no throw on missing file)", () => {
        expect(() =>
            removeTransientNpmAuth("/nonexistent/dir/.npmrc"),
        ).not.toThrow();
    });
});
