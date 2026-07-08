// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileAsync = promisify(execFile);

// Feed auth. A short-lived bearer token is minted by the
// Azure CLI (`az account get-access-token`) and injected into a transient npm
// auth config for the duration of a single install - no persistent .npmrc
// creds / vsts-npm-auth / azureauth state. This is the implementation of the
// `feed` source's auth; it is private to the host (default-agent-provider) and
// the dispatcher core knows nothing about it.

// Azure DevOps resource GUID.
const AZURE_DEVOPS_RESOURCE = "499b84ac-1321-427f-aa17-267ca6975798";

export class FeedAuthError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "FeedAuthError";
    }
}

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | undefined;

/**
 * @internal Test-only hook: an optional command runner returning the raw JSON
 * output of `az account get-access-token`.
 */
export type AzTokenRunner = () => Promise<string>;

async function defaultAzRunner(): Promise<string> {
    try {
        const { stdout } = await execFileAsync(
            "az",
            [
                "account",
                "get-access-token",
                "--resource",
                AZURE_DEVOPS_RESOURCE,
                "--output",
                "json",
            ],
            { shell: process.platform === "win32" },
        );
        return stdout;
    } catch (e: unknown) {
        const detail =
            e && typeof e === "object" && "stderr" in e
                ? String((e as { stderr?: unknown }).stderr ?? "") ||
                  (e instanceof Error ? e.message : String(e))
                : e instanceof Error
                  ? e.message
                  : String(e);
        throw new FeedAuthError(
            `Could not get an Azure DevOps access token from the Azure CLI. ` +
                `Run 'az login' and try again.\n${detail}`,
        );
    }
}

/**
 * Mint (or reuse) a short-lived Azure DevOps bearer token via the Azure CLI.
 * Cached in memory until shortly before expiry; re-minted on demand. Throws an
 * actionable `az login` hint when `az` is missing or logged out.
 */
export async function getFeedAccessToken(
    /** @internal Test-only override for Azure CLI execution. */
    runner: AzTokenRunner = defaultAzRunner,
): Promise<string> {
    const now = Date.now();
    // Reuse the cached token until ~60s before expiry so a long-running install
    // never starts with a token that expires mid-flight.
    if (cachedToken && cachedToken.expiresAt - now > 60_000) {
        return cachedToken.token;
    }
    const stdout = await runner();
    let parsed: { accessToken?: string; expiresOn?: string };
    try {
        parsed = JSON.parse(stdout);
    } catch {
        throw new FeedAuthError(
            `Unexpected 'az account get-access-token' output. Run 'az login' and try again.`,
        );
    }
    if (!parsed.accessToken) {
        throw new FeedAuthError(
            `No access token returned by the Azure CLI. Run 'az login' and try again.`,
        );
    }
    const parsedExpiry = parsed.expiresOn
        ? Date.parse(parsed.expiresOn)
        : Number.NaN;
    const expiresAt = Number.isNaN(parsedExpiry)
        ? now + 30 * 60_000
        : parsedExpiry;
    cachedToken = { token: parsed.accessToken, expiresAt };
    return cachedToken.token;
}

/**
 * Write a throwaway npm userconfig (.npmrc) carrying the bearer token scoped to
 * `registry`. Returns the temp file path; the caller removes it (and its
 * directory) after the install. Nothing persists.
 */
export async function writeTransientNpmAuth(
    registry: string,
    /** @internal Test-only override for Azure CLI execution. */
    runner: AzTokenRunner = defaultAzRunner,
): Promise<string> {
    const token = await getFeedAccessToken(runner);
    // registry "https://.../registry/" -> auth key is the path without scheme.
    const authKey = registry.replace(/^https:/, "");
    const base = registry.replace(/registry\/?$/, "");
    const npmrc =
        `${base}:_authToken=${token}\n` +
        `${authKey}:_authToken=${token}\n` +
        `${authKey}:always-auth=true\n`;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ta-npmauth-"));
    const file = path.join(dir, ".npmrc");
    fs.writeFileSync(file, npmrc, { mode: 0o600 });
    return file;
}

/** Remove a transient npm auth file and its temp directory. */
export function removeTransientNpmAuth(file: string): void {
    try {
        fs.rmSync(path.dirname(file), { recursive: true, force: true });
    } catch {
        // best effort; nothing sensitive persists beyond process lifetime
    }
}

/** @internal Test-only: clear the in-memory token cache. */
export function clearTokenCacheForTest(): void {
    cachedToken = undefined;
}
