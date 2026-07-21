#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * getNPMRC — provision the internal npm registry config + feed auth for
 * developers, mirroring the getKeys workflow.
 *
 * The repo `.npmrc` points pnpm at an Azure Artifacts feed.
 * Because that URL is internal (and this repo is public), the
 * `.npmrc` is gitignored rather than committed — it is stored as a single Azure
 * Key Vault secret and pulled onto developer machines by this script.
 *
 *   pull (default):
 *     1. Read the '<secret>' secret from the '<vault>' Key Vault -> ts/.npmrc.
 *     2. Install a pnpm `tokenHelper` for the feed in ~/.npmrc that mints a
 *        fresh Azure DevOps token on demand (via the Azure CLI) — so feed auth
 *        auto-refreshes and never goes stale while you are signed in to `az`.
 *     3. Seed corepack's cache with the pinned pnpm version from the feed, so
 *        `pnpm` runs without corepack trying to reach the public npm registry.
 *   push:
 *     Upload the local ts/.npmrc as the '<secret>' secret (vault writers only).
 *
 * This script provisions the repo `.npmrc` and therefore runs BEFORE
 * `pnpm install`, so it must have NO installed-package dependencies (needing a
 * package to write the file that lets you install packages is the very
 * chicken-and-egg it exists to break). It uses only Node built-ins plus the
 * Azure CLI (`az`) — which the feed tokenHelper already depends on. Key Vault
 * auth and token acquisition go through `az` and the Key Vault REST API; run
 * `az login` once. The feed tokenHelper re-runs `az`/azureauth on every install.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const config = require("./getNPMRC.config.json");

// --- native ANSI colors (dependency-free chalk stand-in) -----------------
// This script runs before `pnpm install`, so it can't import chalk. Colorize
// only when writing to a TTY and NO_COLOR is unset, matching chalk's default
// auto-detection so redirected logs / CI output stay clean.
const colorEnabled =
    !("NO_COLOR" in process.env) &&
    process.env.TERM !== "dumb" &&
    Boolean(process.stdout.isTTY);
function ansi(open, close) {
    const on = `\u001b[${open}m`;
    const off = `\u001b[${close}m`;
    return (s) => (colorEnabled ? `${on}${s}${off}` : String(s));
}
// Same call surface (and SGR codes) as the chalk methods this script uses.
const chalk = {
    bold: ansi(1, 22),
    dim: ansi(2, 22),
    red: ansi(31, 39),
    green: ansi(32, 39),
    yellow: ansi(33, 39),
    blue: ansi(34, 39),
    magenta: ansi(35, 39),
    cyan: ansi(36, 39),
    gray: ansi(90, 39),
    grey: ansi(90, 39),
    redBright: ansi(91, 39),
    greenBright: ansi(92, 39),
    yellowBright: ansi(93, 39),
    blueBright: ansi(94, 39),
    magentaBright: ansi(95, 39),
    cyanBright: ansi(96, 39),
    whiteBright: ansi(97, 39),
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoNpmrcPath = path.resolve(__dirname, config.npmrcPath);
const userNpmrcPath = path.join(os.homedir(), ".npmrc");

const KEY_VAULT_SCOPE = "https://vault.azure.net/.default";
const typeagentDir = path.join(os.homedir(), ".typeagent");

let paramVault = undefined;
let paramSecret = undefined;
let paramCommit = true;
let paramAuthOnly = false;
// Feed auth mechanism (default "azureauth"):
//   azureauth    — tokenHelper using the azureauth CLI; an Entra ID token for
//                  Azure DevOps, cached & silently refreshed via the OS broker
//                  (WAM). No PAT stored, no rotation, CAE-aware. If the azureauth
//                  CLI isn't installed and this default wasn't chosen explicitly,
//                  it falls back to the az-backed token-helper below.
//   pat          — mint a rotating Azure DevOps PAT; Basic auth in ~/.npmrc.
//   token-helper — az-backed tokenHelper (CAE-fragile; needs `az login`).
let paramAuthMode = process.env.TYPEAGENT_NPM_AUTH ?? "azureauth";
// Whether the mode was chosen explicitly (env var or --auth) vs. defaulted. A
// defaulted azureauth mode falls back to token-helper when azureauth is absent;
// an explicit azureauth still hard-errors so the user gets what they asked for.
let authModeExplicit = process.env.TYPEAGENT_NPM_AUTH !== undefined;

// --- identity (mirrors getKeys.mjs) --------------------------------------

// Decode a JWT (no signature verification — we only want the claims to print
// friendly identity info).
function decodeJwtClaims(token) {
    try {
        const [, payload] = token.split(".");
        if (!payload) return undefined;
        const b64 = payload.replace(/-/g, "+").replace(/_/g, "/");
        const pad =
            b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
        return JSON.parse(Buffer.from(b64 + pad, "base64").toString("utf8"));
    } catch {
        return undefined;
    }
}

function printIdentity(jwt) {
    const claims = decodeJwtClaims(jwt);
    const who = claims?.upn ?? claims?.preferred_username ?? claims?.name;
    if (who) console.log(`Logged in as ${chalk.cyanBright(who)}`);
}

// az takes a resource/audience URI, not an OAuth scope: strip a trailing
// "/.default" so "https://vault.azure.net/.default" -> "https://vault.azure.net"
// and "<guid>/.default" -> "<guid>".
function scopeToResource(scope) {
    return scope.replace(/\/\.default$/i, "");
}

// Run an `az` subcommand and capture stdout. Returns { ok, stdout }; ok is false
// when az is missing, errors, or isn't signed in (stderr is discarded). Never
// throws, so callers can branch on az's state from its JSON output instead of
// handling exceptions.
function runAz(args) {
    try {
        const stdout = execFileSync("az", args, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            shell: process.platform === "win32",
        });
        return { ok: true, stdout };
    } catch {
        return { ok: false, stdout: "" };
    }
}

// Acquire an access token for `scope` from the signed-in Azure CLI session.
// Shape mirrors @azure/identity's getToken() result ({ token }); returns
// undefined when `az` is missing or not signed in. Never logs the token.
async function azGetToken(scope) {
    const tenantId = process.env.AZURE_TENANT_ID;
    const args = [
        "account",
        "get-access-token",
        "--resource",
        scopeToResource(scope),
        "--output",
        "json",
        "--only-show-errors",
    ];
    if (tenantId) args.push("--tenant", tenantId);
    const res = runAz(args);
    if (!res.ok) return undefined; // az missing or not signed in
    try {
        const data = JSON.parse(res.stdout);
        return data?.accessToken ? { token: data.accessToken } : undefined;
    } catch {
        return undefined;
    }
}

// A credential compatible with the callers below (they only need getToken).
const azCredential = { getToken: azGetToken };

// Interactive `az login` (opens a browser) — the dependency-free equivalent of
// @azure/identity's InteractiveBrowserCredential fallback. Cross-tenant vaults
// are handled by az's own tenant selection (honoring AZURE_TENANT_ID).
function azLogin() {
    const tenantId = process.env.AZURE_TENANT_ID;
    const args = ["login", "--only-show-errors"];
    if (tenantId) args.push("--tenant", tenantId);
    execFileSync("az", args, {
        stdio: "inherit",
        shell: process.platform === "win32",
    });
}

// Get an Azure credential backed by the Azure CLI. If no silent token is
// available (az not signed in), fall back to an interactive `az login`, then
// retry. Returns a credential exposing getToken(scope).
async function getAzureCredential() {
    let token = await azCredential.getToken(KEY_VAULT_SCOPE);
    if (!token?.token) {
        console.warn(
            chalk.yellowBright(
                "No signed-in Azure CLI session — launching `az login`...",
            ),
        );
        try {
            azLogin();
        } catch {
            throw new Error(
                "Azure CLI login failed. Install the Azure CLI (https://aka.ms/azcli) and run `az login`, then retry.",
            );
        }
        token = await azCredential.getToken(KEY_VAULT_SCOPE);
        if (!token?.token) {
            throw new Error(
                "Could not acquire an Azure token after `az login`. Run `az login` and retry.",
            );
        }
    }
    printIdentity(token.token);
    return azCredential;
}

// Cache the credential so we don't re-run the auth chain (or prompt twice) when
// both the Key Vault pull and the PAT mint need a token in the same run.
let cachedCredential;
async function getCredential() {
    if (!cachedCredential) {
        cachedCredential = await getAzureCredential();
    }
    return cachedCredential;
}

// --- Key Vault REST (no SDK) ---------------------------------------------
// Talk to Key Vault's data-plane REST API directly with a bearer token from
// `az`, replacing @azure/keyvault-secrets. Same vault URL and 404 handling the
// SDK surfaced, so the callers' error paths are unchanged.
const KEY_VAULT_API_VERSION = "7.4";

function keyVaultSecretUrl(vault, secret) {
    return `https://${vault}.vault.azure.net/secrets/${encodeURIComponent(
        secret,
    )}?api-version=${KEY_VAULT_API_VERSION}`;
}

// Perform a Key Vault request with a bearer token; throw an Error carrying the
// HTTP status (as .statusCode, matching the SDK) on failure.
async function keyVaultRequest(credential, url, init) {
    const at = await credential.getToken(KEY_VAULT_SCOPE);
    if (!at?.token) {
        throw new Error("Could not acquire a Key Vault access token.");
    }
    const res = await fetch(url, {
        ...init,
        headers: { ...init?.headers, authorization: `Bearer ${at.token}` },
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        const err = new Error(
            `HTTP ${res.status} ${res.statusText}. ${body.slice(0, 300)}`.trim(),
        );
        err.statusCode = res.status;
        throw err;
    }
    return res;
}

async function keyVaultGetSecret(credential, vault, secret) {
    const res = await keyVaultRequest(
        credential,
        keyVaultSecretUrl(vault, secret),
    );
    const data = await res.json();
    return data.value;
}

async function keyVaultSetSecret(credential, vault, secret, value) {
    await keyVaultRequest(credential, keyVaultSecretUrl(vault, secret), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
    });
}

// --- npmrc helpers -------------------------------------------------------

function parseRegistry(npmrcContent) {
    for (const line of npmrcContent.split(/\r?\n/)) {
        const m = line.match(/^\s*registry\s*=\s*(\S+)/);
        if (m) return m[1];
    }
    return undefined;
}

// https://host/path/ -> //host/path/  (the npm auth "nerf dart" key prefix)
function registryToNerfDart(registryUrl) {
    const noScheme = registryUrl.replace(/^https?:/i, "");
    return noScheme.endsWith("/") ? noScheme : noScheme + "/";
}

// Generate a small platform token helper in ~/.typeagent that prints a fresh
// Azure DevOps access token to stdout. pnpm runs it on every feed auth and `az`
// refreshes the token transparently, so auth never goes stale while the az login
// session is valid. Returns the helper's absolute path (forward slashes —
// accepted by both pnpm and Windows, and safe from .npmrc backslash escaping).
function writeTokenHelperScript() {
    fs.mkdirSync(typeagentDir, { recursive: true });
    const adoResource =
        process.env.TYPEAGENT_ADO_RESOURCE ?? config.adoResource;
    if (
        typeof adoResource !== "string" ||
        !/^[0-9A-Za-z-.:/]+$/.test(adoResource)
    ) {
        throw new Error(
            `Invalid adoResource '${adoResource}'. Use a GUID / URL-safe resource id.`,
        );
    }
    const azCmd = `az account get-access-token --resource "${adoResource}" --query accessToken --output tsv --only-show-errors`;

    let helperPath;
    if (process.platform === "win32") {
        helperPath = path.join(typeagentDir, "npmrc-token-helper.cmd");
        fs.writeFileSync(helperPath, `@echo off\r\n${azCmd}\r\n`);
    } else {
        // macOS / Linux: an executable shell script. Prepend the common
        // Homebrew/az install locations so the helper finds `az` even when pnpm
        // is launched with a minimal PATH (e.g. a macOS GUI app), while still
        // honoring an `az` already on the inherited PATH.
        helperPath = path.join(typeagentDir, "npmrc-token-helper.sh");
        fs.writeFileSync(
            helperPath,
            `#!/bin/sh\nexport PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"\nexec ${azCmd}\n`,
        );
        fs.chmodSync(helperPath, 0o755);
    }
    return helperPath.replace(/\\/g, "/");
}

// Write/refresh the feed tokenHelper in ~/.npmrc without disturbing the user's
// other registry credentials (office / msctoproj / etc.). Also clears any prior
// static _authToken for the same registry.
function upsertTokenHelper(nerfDart, helperPath) {
    const line = `${nerfDart}:tokenHelper=${helperPath}`;
    let lines = fs.existsSync(userNpmrcPath)
        ? fs.readFileSync(userNpmrcPath, "utf8").split(/\r?\n/)
        : [];
    const esc = nerfDart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stale = new RegExp(
        `^\\s*${esc}:(?:_authToken|_auth|tokenHelper|username|_password|email)\\s*=`,
    );
    lines = lines.filter((l) => !stale.test(l));
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(line);
    fs.writeFileSync(userNpmrcPath, lines.join("\n") + "\n");
}

// Parse the Azure DevOps org and feed name from an npm registry URL. Supports
// project-scoped and org-scoped feeds on both the modern and legacy hosts:
//   https://pkgs.dev.azure.com/{org}/{project}/_packaging/{feed}/npm/registry/
//   https://pkgs.dev.azure.com/{org}/_packaging/{feed}/npm/registry/
//   https://{org}.pkgs.visualstudio.com/_packaging/{feed}/npm/registry/
function parseAdoRegistry(registry) {
    const u = new URL(registry);
    const feed = u.pathname.match(/\/_packaging\/([^/]+)\//)?.[1];
    let org;
    const legacy = u.hostname.match(/^([^.]+)\.pkgs\.visualstudio\.com$/i);
    if (legacy) {
        org = legacy[1];
    } else if (/^pkgs\.dev\.azure\.com$/i.test(u.hostname)) {
        org = u.pathname.split("/").filter(Boolean)[0];
    }
    if (!org || !feed) {
        throw new Error(
            `Could not parse Azure DevOps org/feed from registry: ${registry}`,
        );
    }
    return { org, feed };
}

// Mint an Azure DevOps Personal Access Token scoped to Packaging (read) via the
// PATs REST API, authenticating with an AAD bearer token from `credential`.
// Returns { token, validTo, authorizationId }. Never logs the token value.
async function createFeedPat(credential, org, feed) {
    const adoResource =
        process.env.TYPEAGENT_ADO_RESOURCE ?? config.adoResource;
    const at = await credential.getToken(`${adoResource}/.default`);
    if (!at?.token) {
        throw new Error("Could not acquire an Azure DevOps access token.");
    }
    const days = Number(process.env.TYPEAGENT_PAT_DAYS ?? config.patDays ?? 90);
    const validTo = new Date(
        Date.now() + days * 24 * 60 * 60 * 1000,
    ).toISOString();
    const url = `https://vssps.dev.azure.com/${encodeURIComponent(
        org,
    )}/_apis/tokens/pats?api-version=7.1-preview.1`;
    const res = await fetch(url, {
        method: "POST",
        headers: {
            authorization: `Bearer ${at.token}`,
            "content-type": "application/json",
        },
        body: JSON.stringify({
            displayName: `${feed} npm (getNPMRC ${new Date()
                .toISOString()
                .slice(0, 10)})`,
            scope: "vso.packaging",
            validTo,
            allOrgs: false,
        }),
    });
    const body = await res.text();
    if (res.status === 401) {
        throw new Error(
            "Azure DevOps returned 401 while creating the PAT (token revoked or insufficient claims).",
        );
    }
    if (!res.ok) {
        throw new Error(
            `PAT creation failed: HTTP ${res.status} ${res.statusText}. ${body.slice(0, 300)}`,
        );
    }
    let data;
    try {
        data = JSON.parse(body);
    } catch {
        throw new Error(
            `PAT API returned a non-JSON response (wrong tenant?): ${body.slice(0, 200)}`,
        );
    }
    const token = data?.patToken?.token;
    // Azure DevOps returns patTokenError: "none" on SUCCESS — only a value other
    // than "none" is an actual error (e.g. a policy denial).
    const patErr = data?.patTokenError;
    if (patErr && patErr !== "none") {
        throw new Error(
            `PAT creation was denied (patTokenError=${patErr}). Your organization may restrict PAT creation — fall back to --auth token-helper.`,
        );
    }
    if (!token) {
        throw new Error(
            `PAT API returned no token and no error (unexpected response): ${body.slice(0, 200)}`,
        );
    }
    return {
        token,
        validTo: data.patToken?.validTo ?? validTo,
        authorizationId: data.patToken?.authorizationId,
    };
}

// Best-effort: revoke previously getNPMRC-created PATs for this feed (matched by
// display-name prefix) except the one we just created, so rotation and any
// earlier buggy runs don't leave orphaned tokens behind. Never throws.
async function revokeOldFeedPats(credential, org, feed, keepAuthorizationId) {
    const adoResource =
        process.env.TYPEAGENT_ADO_RESOURCE ?? config.adoResource;
    const prefix = `${feed} npm (getNPMRC`;
    const base = `https://vssps.dev.azure.com/${encodeURIComponent(
        org,
    )}/_apis/tokens/pats?api-version=7.1-preview.1`;
    try {
        const at = await credential.getToken(`${adoResource}/.default`);
        if (!at?.token) return 0;
        const auth = { authorization: `Bearer ${at.token}` };
        const res = await fetch(base, { headers: auth });
        if (!res.ok) return 0;
        const data = await res.json();
        const pats = Array.isArray(data?.patTokens) ? data.patTokens : [];
        let revoked = 0;
        for (const p of pats) {
            if (
                p?.authorizationId &&
                p.authorizationId !== keepAuthorizationId &&
                typeof p.displayName === "string" &&
                p.displayName.startsWith(prefix)
            ) {
                const del = await fetch(
                    `${base}&authorizationId=${encodeURIComponent(
                        p.authorizationId,
                    )}`,
                    { method: "DELETE", headers: auth },
                ).catch(() => undefined);
                if (del?.ok) revoked++;
            }
        }
        return revoked;
    } catch {
        return 0; // best-effort
    }
}

// Write PAT Basic-auth lines for the feed nerf-dart into ~/.npmrc, replacing any
// prior auth entries (tokenHelper / _authToken / username / _password / email)
// for the same registry. `_password` holds the base64-encoded PAT, per Azure
// DevOps' npm convention.
function upsertFeedBasicAuth(nerfDart, org, pat) {
    const b64 = Buffer.from(pat, "utf8").toString("base64");
    const entries = [
        `${nerfDart}:username=${org}`,
        `${nerfDart}:_password=${b64}`,
        `${nerfDart}:email=npm-requires-email-not-used@example.com`,
    ];
    let lines = fs.existsSync(userNpmrcPath)
        ? fs.readFileSync(userNpmrcPath, "utf8").split(/\r?\n/)
        : [];
    const esc = nerfDart.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const stale = new RegExp(
        `^\\s*${esc}:(?:_authToken|_auth|tokenHelper|username|_password|email)\\s*=`,
    );
    lines = lines.filter((l) => !stale.test(l));
    while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
    lines.push(...entries);
    fs.writeFileSync(userNpmrcPath, lines.join("\n") + "\n");
    if (process.platform !== "win32") {
        try {
            fs.chmodSync(userNpmrcPath, 0o600);
        } catch {
            // best-effort hardening; ignore where unsupported
        }
    }
}

// Azure CLI health for the feed tokenHelper (which shells out to `az` at
// pnpm-install time). Uses az's JSON output to distinguish "not installed" from
// "installed but not signed in", and returns the signed-in identity when
// available. Non-fatal: callers warn on a missing/blank state, they don't abort.
function azAccountStatus() {
    // `az version` prints JSON only when the CLI is installed and runnable.
    if (!runAz(["version", "--output", "json"]).ok) {
        return { installed: false, signedIn: false };
    }
    const res = runAz(["account", "show", "--output", "json"]);
    if (!res.ok) {
        return { installed: true, signedIn: false };
    }
    try {
        const account = JSON.parse(res.stdout);
        return { installed: true, signedIn: true, user: account?.user?.name };
    } catch {
        return { installed: true, signedIn: true };
    }
}

// True if the azureauth CLI (Microsoft's MSAL/WAM auth helper) is available.
async function hasAzureAuth() {
    try {
        const { execFileSync } = await import("node:child_process");
        execFileSync("azureauth", ["--version"], {
            stdio: "ignore",
            shell: process.platform === "win32",
        });
        return true;
    } catch {
        return false;
    }
}

// Write a tokenHelper that prints an Azure DevOps Entra token from azureauth.
// azureauth caches and silently refreshes via the OS broker (WAM on Windows) and
// answers CAE claims challenges, so no PAT is stored and there is no periodic
// rotation. Returns the helper's absolute path (forward slashes).
function writeAzureAuthTokenHelper() {
    fs.mkdirSync(typeagentDir, { recursive: true });
    let helperPath;
    if (process.platform === "win32") {
        helperPath = path.join(typeagentDir, "npmrc-azureauth-helper.cmd");
        fs.writeFileSync(
            helperPath,
            `@echo off\r\nazureauth ado token --output token --mode broker --prompt-hint "typeagent-feed npm (pnpm)"\r\n`,
        );
    } else {
        helperPath = path.join(typeagentDir, "npmrc-azureauth-helper.sh");
        fs.writeFileSync(
            helperPath,
            `#!/bin/sh\nexport PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"\nexec azureauth ado token --output token --prompt-hint "typeagent-feed npm (pnpm)"\n`,
        );
        fs.chmodSync(helperPath, 0o755);
    }
    return helperPath.replace(/\\/g, "/");
}

// Run azureauth once (default broker→web mode) to sign in / warm the token cache
// so the broker-only helper resolves silently during `pnpm install`. Returns
// true on success. Never logs the token.
async function primeAzureAuth() {
    try {
        const { execFileSync } = await import("node:child_process");
        // NB: no spaces in the prompt-hint — with shell:true on Windows,
        // execFileSync does not quote args, so a spaced value would be split.
        execFileSync(
            "azureauth",
            [
                "ado",
                "token",
                "--output",
                "token",
                "--prompt-hint",
                "typeagent-feed-npm-setup",
            ],
            {
                stdio: ["inherit", "ignore", "inherit"],
                shell: process.platform === "win32",
                timeout: 15 * 60 * 1000,
            },
        );
        return true;
    } catch {
        return false;
    }
}

// --- corepack pnpm seeding -----------------------------------------------

// Corepack fetches the pinned pnpm binary (package.json "packageManager") from
// its OWN registry — it does not read .npmrc, and it defaults to the public npm
// registry, which is blocked here. Pointing COREPACK_NPM_REGISTRY at the feed
// also fails because Azure Artifacts does not serve the per-version metadata
// endpoint corepack requests. To bypass both, download the pinned pnpm tarball
// from the feed (whose tarball path works), verify it against the pinned
// sha512, and drop it directly into corepack's cache so corepack runs it with
// no network fetch.

// Corepack's on-disk cache location. Mirrors corepack's own resolution exactly
// (COREPACK_HOME, then XDG_CACHE_HOME, then LOCALAPPDATA, then a platform
// default under the home dir) so a manually placed entry is found at runtime on
// every platform.
function corepackHomeFolder() {
    if (process.env.COREPACK_HOME) return process.env.COREPACK_HOME;
    const home = os.homedir();
    const base =
        process.env.XDG_CACHE_HOME ||
        process.env.LOCALAPPDATA ||
        path.join(
            home,
            process.platform === "win32"
                ? path.join("AppData", "Local")
                : ".cache",
        );
    return path.join(base, "node", "corepack");
}

// Parse the pinned pnpm spec from ts/package.json "packageManager":
//   "pnpm@11.9.0+sha512.<hex>" -> { version, hash, hexHash }
function parsePinnedPnpm() {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    let pkg;
    try {
        pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    } catch {
        return undefined;
    }
    const pm = pkg.packageManager;
    if (typeof pm !== "string") return undefined;
    const m = pm.match(/^pnpm@([^+\s]+)\+(sha512\.[0-9a-f]+)$/);
    if (!m) return undefined;
    return {
        version: m[1],
        hash: m[2],
        hexHash: m[2].slice("sha512.".length),
    };
}

// True if corepack's cache already holds pnpm at the exact pinned locator.
function corepackPnpmAlreadySeeded(markerPath, reference) {
    if (!fs.existsSync(markerPath)) return false;
    try {
        const existing = JSON.parse(fs.readFileSync(markerPath, "utf8"));
        return existing?.locator?.reference === reference;
    } catch {
        return false;
    }
}

// Extract the pnpm tarball into corepack's cache dir, stripping the tarball's
// leading "package/" directory.
async function extractPnpmTarball(buf, destDir, version) {
    fs.rmSync(destDir, { recursive: true, force: true });
    fs.mkdirSync(destDir, { recursive: true });
    const tmpTgz = path.join(os.tmpdir(), `pnpm-${version}-${process.pid}.tgz`);
    fs.writeFileSync(tmpTgz, buf);
    try {
        const { spawnSync } = await import("node:child_process");
        const r = spawnSync(
            "tar",
            ["-xzf", tmpTgz, "-C", destDir, "--strip-components=1"],
            { stdio: ["ignore", "ignore", "pipe"] },
        );
        if (r.error) throw r.error;
        if (r.status !== 0) {
            throw new Error(
                `tar exited ${r.status}: ${r.stderr?.toString().trim() || "unknown error"}`,
            );
        }
    } finally {
        fs.rmSync(tmpTgz, { force: true });
    }
}

// Write corepack's cache marker so it runs this version without a fetch. bin
// entries come from the extracted package.json, path-normalized the way
// corepack records them.
function writeCorepackMarker(destDir, markerPath, version, hash) {
    const extractedPkg = JSON.parse(
        fs.readFileSync(path.join(destDir, "package.json"), "utf8"),
    );
    const rawBin =
        typeof extractedPkg.bin === "string"
            ? { [extractedPkg.name]: extractedPkg.bin }
            : (extractedPkg.bin ?? {});
    const bin = {};
    for (const [name, rel] of Object.entries(rawBin)) {
        bin[name] = rel.startsWith("./") ? rel : `./${rel}`;
    }
    const marker = {
        locator: { name: "pnpm", reference: `${version}+${hash}` },
        bin,
        hash,
    };
    fs.writeFileSync(markerPath, JSON.stringify(marker), "utf8");
}

async function seedCorepackPnpm() {
    if (process.exitCode) return; // pull already failed; don't seed

    const pinned = parsePinnedPnpm();
    if (!pinned) {
        console.warn(
            chalk.yellow(
                'Could not read a pinned "pnpm@<version>+sha512…" from package.json — skipping corepack seed.',
            ),
        );
        return;
    }
    const { version, hash, hexHash } = pinned;

    const destDir = path.join(corepackHomeFolder(), "v1", "pnpm", version);
    const markerPath = path.join(destDir, ".corepack");

    // Already seeded with the exact pinned locator? Nothing to do.
    if (corepackPnpmAlreadySeeded(markerPath, `${version}+${hash}`)) {
        console.log(
            chalk.gray(
                `corepack already has pnpm@${version} cached — skipping seed.`,
            ),
        );
        return;
    }

    let registry;
    try {
        registry = parseRegistry(fs.readFileSync(repoNpmrcPath, "utf8"));
    } catch {
        registry = undefined;
    }
    const tarballUrl = registry
        ? `${registry.replace(/\/+$/, "")}/pnpm/-/pnpm-${version}.tgz`
        : undefined;

    // In dry-run, report intent even if .npmrc isn't present yet (pull writes it
    // in commit mode); only treat a missing registry as a hard skip when we
    // would actually seed.
    if (!paramCommit) {
        console.log(
            chalk.gray(
                `[dry-run] Would seed corepack cache with pnpm@${version}` +
                    (tarballUrl
                        ? ` from ${tarballUrl}.`
                        : " from the feed configured in .npmrc."),
            ),
        );
        return;
    }

    if (!registry) {
        console.warn(
            chalk.yellow(
                "No registry in .npmrc — cannot seed corepack pnpm. Skipping.",
            ),
        );
        return;
    }

    console.log(
        `Seeding corepack cache with pnpm@${chalk.cyanBright(version)}...`,
    );
    try {
        // Mint an Azure DevOps token for the feed (same resource the feed uses
        // for installs, honoring the TYPEAGENT_ADO_RESOURCE override).
        // getCredential() is cached, so this reuses the login from the Key Vault
        // pull above without prompting again.
        const credential = await getCredential();
        const adoResource =
            process.env.TYPEAGENT_ADO_RESOURCE ?? config.adoResource;
        const at = await credential.getToken(`${adoResource}/.default`);
        if (!at?.token) {
            throw new Error("could not acquire an Azure DevOps token");
        }

        const res = await fetch(tarballUrl, {
            headers: { Authorization: `Bearer ${at.token}` },
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status} fetching ${tarballUrl}`);
        }
        const buf = Buffer.from(await res.arrayBuffer());

        // Verify the download against the pinned integrity hash before trusting
        // it — never inject an unverified binary into the cache.
        const crypto = await import("node:crypto");
        const actual = crypto.createHash("sha512").update(buf).digest("hex");
        if (actual !== hexHash) {
            throw new Error(
                `integrity mismatch: expected sha512 ${hexHash.slice(0, 16)}…, got ${actual.slice(0, 16)}…`,
            );
        }

        // Extract package/* into the cache dir and write corepack's cache
        // marker so it runs this version without a fetch.
        await extractPnpmTarball(buf, destDir, version);
        writeCorepackMarker(destDir, markerPath, version, hash);

        console.log(
            chalk.green(
                `Seeded corepack cache with pnpm@${version} (integrity verified). ` +
                    "`pnpm` now runs without contacting the public npm registry.",
            ),
        );
    } catch (e) {
        console.warn(
            chalk.yellowBright(
                `Could not seed corepack's pnpm@${version} (${e?.message ?? String(e)}).\n` +
                    "Non-fatal: .npmrc and feed auth are still set up. If `pnpm` later fails with a\n" +
                    "corepack download error, re-run this script or seed pnpm manually.",
            ),
        );
    }
}

// --- commands ------------------------------------------------------------

async function pull() {
    const vault = paramVault ?? config.vault;
    const secret = paramSecret ?? config.secret;

    let npmrcContent;
    if (paramAuthOnly) {
        if (!fs.existsSync(repoNpmrcPath)) {
            console.error(
                chalk.red(
                    `${repoNpmrcPath} not found — run without --auth-only first.`,
                ),
            );
            process.exitCode = 1;
            return;
        }
        npmrcContent = fs.readFileSync(repoNpmrcPath, "utf8");
    } else {
        console.log(
            `Pulling ${chalk.cyanBright(secret)} from ${chalk.cyanBright(vault)} key vault...`,
        );
        const credential = await getCredential();
        let value;
        try {
            value = await keyVaultGetSecret(credential, vault, secret);
        } catch (e) {
            const status = e?.statusCode ?? e?.status;
            console.error(
                chalk.red(
                    `Failed to read '${secret}' from vault '${vault}': ${e?.message ?? String(e)}`,
                ),
            );
            console.log(
                chalk.yellow(
                    status === 404
                        ? `\nHint: seed it first with:  npm run getNPMRC -- push`
                        : `\nHint: if you don't have access to this vault, pass --vault/--secret to use your own (or ask a maintainer for access).`,
                ),
            );
            process.exitCode = 1;
            return;
        }
        if (!value) {
            console.error(chalk.red(`Secret '${secret}' is empty.`));
            process.exitCode = 1;
            return;
        }
        npmrcContent = value;
        if (paramCommit) {
            await fs.promises.writeFile(repoNpmrcPath, npmrcContent, "utf8");
            console.log(`Written ${chalk.cyanBright(repoNpmrcPath)}.`);
        } else {
            console.log(
                `[dry-run] Would write ${chalk.cyanBright(repoNpmrcPath)}.`,
            );
        }
    }

    // Feed auth (default 'azureauth'): install a tokenHelper backed by the
    // azureauth CLI (Entra token, broker-cached, no PAT). 'pat' mints a rotating
    // PAT (Basic auth); 'token-helper' uses an az-backed tokenHelper.
    const registry = parseRegistry(npmrcContent);
    if (!registry) {
        console.warn(
            chalk.yellow("No registry= line in .npmrc — skipping feed auth."),
        );
        return;
    }
    if (!/^https:\/\//i.test(registry)) {
        console.error(
            chalk.red(`Registry must be https:// for feed auth: ${registry}`),
        );
        process.exitCode = 1;
        return;
    }
    const nerfDart = registryToNerfDart(registry);
    if (!paramCommit) {
        console.log(
            `[dry-run] Would install feed auth (${paramAuthMode}) for ${chalk.cyanBright(registry)}.`,
        );
        return;
    }

    // Default mode is 'azureauth', which needs a separate azureauth CLI. When it
    // isn't installed and the user didn't explicitly ask for it, fall back to the
    // az-backed token helper (az is already required by this script and was
    // confirmed working above) rather than failing the whole bootstrap.
    if (paramAuthMode === "azureauth" && !(await hasAzureAuth())) {
        if (authModeExplicit) {
            console.error(
                chalk.red(
                    "azureauth CLI not found. Install it (https://aka.ms/azureauth), or use\n" +
                        "another mode: --auth pat  or  --auth token-helper.",
                ),
            );
            process.exitCode = 1;
            return;
        }
        console.warn(
            chalk.yellow(
                "azureauth CLI not found — falling back to the az-backed token helper.\n" +
                    "Install azureauth (https://aka.ms/azureauth) for broker-cached, CAE-aware\n" +
                    "auth, or pass --auth pat.",
            ),
        );
        paramAuthMode = "token-helper";
    }

    if (paramAuthMode === "azureauth") {
        const helperPath = writeAzureAuthTokenHelper();
        upsertTokenHelper(nerfDart, helperPath);
        console.log(
            chalk.green(
                `Feed azureauth tokenHelper installed in ${chalk.cyanBright(userNpmrcPath)} (no PAT; Entra token auto-refreshed via the OS broker).`,
            ),
        );
        if (await primeAzureAuth()) {
            console.log(
                chalk.green(
                    "Verified: azureauth returned an Azure DevOps token.",
                ),
            );
        } else {
            console.warn(
                chalk.yellowBright(
                    "Could not get a token non-interactively just now — the first `pnpm install`\n" +
                        "may prompt once via the OS broker, then cache silently.",
                ),
            );
        }
        // Feed auth no longer uses a PAT: revoke any leftover getNPMRC-created
        // PATs (best-effort). Their ~/.npmrc lines were already replaced above.
        try {
            const { org, feed } = parseAdoRegistry(registry);
            const revoked = await revokeOldFeedPats(
                await getCredential(),
                org,
                feed,
                null,
            );
            if (revoked > 0) {
                console.log(
                    chalk.gray(
                        `Revoked ${revoked} leftover getNPMRC PAT(s) for this feed.`,
                    ),
                );
            }
        } catch {
            // best-effort cleanup; ignore
        }
        return;
    }

    if (paramAuthMode === "token-helper") {
        const helperPath = writeTokenHelperScript();
        upsertTokenHelper(nerfDart, helperPath);
        console.log(
            chalk.green(
                `Feed tokenHelper installed in ${chalk.cyanBright(userNpmrcPath)} (auto-refreshes via az).`,
            ),
        );
        const status = azAccountStatus();
        if (!status.installed) {
            console.warn(
                chalk.yellowBright(
                    "\nWARNING: the Azure CLI (`az`) was not found. Install it\n" +
                        "(https://aka.ms/azcli) and run `az login`, or `pnpm install` will 401.",
                ),
            );
        } else if (!status.signedIn) {
            console.warn(
                chalk.yellowBright(
                    "\nWARNING: `az` is not signed in. Run `az login` so the feed tokenHelper\n" +
                        "can mint tokens — otherwise `pnpm install` will 401.",
                ),
            );
        } else {
            // Verify the helper will work by actually minting the feed token now
            // (JSON captured, token never printed) — symmetric with the azureauth
            // path's verification.
            const adoResource =
                process.env.TYPEAGENT_ADO_RESOURCE ?? config.adoResource;
            const at = await azCredential.getToken(`${adoResource}/.default`);
            if (at?.token) {
                console.log(
                    chalk.green(
                        "Verified: az returned an Azure DevOps feed token" +
                            (status.user
                                ? ` for ${chalk.cyanBright(status.user)}.`
                                : "."),
                    ),
                );
            } else {
                console.warn(
                    chalk.yellowBright(
                        "Signed in to `az`, but couldn't mint an Azure DevOps feed token just now.\n" +
                            "Re-run `az login` if `pnpm install` later returns 401.",
                    ),
                );
            }
        }
        return;
    }

    if (paramAuthMode !== "pat") {
        console.error(
            chalk.red(
                `Unknown --auth mode '${paramAuthMode}'. Use 'azureauth', 'pat', or 'token-helper'.`,
            ),
        );
        process.exitCode = 1;
        return;
    }

    // PAT mode (default): mint a rotating Azure DevOps Personal Access Token and
    // write Basic auth. Unlike an AAD access token, a PAT is not revoked
    // mid-life by Continuous Access Evaluation, so `pnpm install` keeps working
    // until the PAT expires — rotate by re-running this script.
    const { org, feed } = parseAdoRegistry(registry);
    let pat;
    try {
        const credential = await getCredential();
        pat = await createFeedPat(credential, org, feed);
    } catch (e) {
        console.error(
            chalk.red(`Failed to mint feed PAT: ${e?.message ?? String(e)}`),
        );
        console.log(
            chalk.yellow(
                "\nHints:\n" +
                    "  • If your session was revoked (CAE) or you are not signed in, run `az login` and retry.\n" +
                    "  • If your organization blocks PAT creation, use the helper instead:\n" +
                    "      npm run getNPMRC -- --auth-only --auth token-helper",
            ),
        );
        process.exitCode = 1;
        return;
    }
    upsertFeedBasicAuth(nerfDart, org, pat.token);
    const validUntil = pat.validTo
        ? new Date(pat.validTo).toLocaleString()
        : "the configured lifetime";
    console.log(
        chalk.green(
            `Feed PAT installed in ${chalk.cyanBright(userNpmrcPath)} (valid until ${validUntil}).`,
        ),
    );
    const revoked = await revokeOldFeedPats(
        await getCredential(),
        org,
        feed,
        pat.authorizationId,
    );
    if (revoked > 0) {
        console.log(
            chalk.gray(
                `Revoked ${revoked} older getNPMRC PAT(s) for this feed.`,
            ),
        );
    }
    console.log(
        chalk.gray(
            "Re-run `npm run getNPMRC` before it expires to rotate the PAT.",
        ),
    );
}

async function push() {
    if (!fs.existsSync(repoNpmrcPath)) {
        console.error(
            chalk.red(`${repoNpmrcPath} not found. Nothing to push.`),
        );
        process.exitCode = 1;
        return;
    }
    const content = await fs.promises.readFile(repoNpmrcPath, "utf8");
    // Reject files that contain auth lines to avoid persisting credentials in Key Vault.
    if (
        /^\s*(?![#;])(?:[^:]*:)?(?:_authToken|_auth|_password|tokenHelper|username|email)\s*=/m.test(
            content,
        )
    ) {
        console.error(
            chalk.red(
                `${repoNpmrcPath} contains auth lines (_authToken / _password / tokenHelper / etc.).\n` +
                    `Remove all credential entries before pushing to avoid persisting secrets in Key Vault.`,
            ),
        );
        process.exitCode = 1;
        return;
    }
    const vault = paramVault ?? config.vault;
    const secret = paramSecret ?? config.secret;
    const credential = await getAzureCredential();
    console.log(
        `Pushing ${chalk.cyanBright(repoNpmrcPath)} as '${chalk.cyanBright(secret)}' to ${chalk.cyanBright(vault)} key vault.`,
    );
    if (!paramCommit) {
        console.log(
            `[dry-run] Would write secret '${secret}' to vault '${vault}'.`,
        );
        return;
    }
    try {
        await keyVaultSetSecret(credential, vault, secret, content);
        console.log(
            chalk.green(`Secret '${secret}' updated in vault '${vault}'.`),
        );
    } catch (e) {
        console.error(
            chalk.red(
                `Failed to write '${secret}': ${e?.message ?? String(e)}`,
            ),
        );
        process.exitCode = 1;
    }
}

function printHelp() {
    console.log(`
${chalk.bold("getNPMRC")} — provision the internal npm registry config + feed auth

${chalk.bold("Usage:")}
  npm run getNPMRC -- [command] [options]
  node tools/scripts/getNPMRC.mjs [command] [options]

${chalk.bold("Commands:")}
  pull    Download ts/.npmrc from Key Vault, set up feed auth, and seed corepack's
          pnpm cache (default)
  push    Upload local ts/.npmrc to Key Vault (vault writers only)
  help    Show this help

${chalk.bold("Options:")}
  --auth <mode> Feed auth: 'azureauth' (default), 'pat', or 'token-helper'
  --auth-only   Skip the Key Vault download; just (re)install feed auth
  --vault <n>   Key Vault name (default: ${config.vault})
  --secret <n>  Secret name (default: ${config.secret})
  --commit      Write changes (default)
  --dry-run     Preview without writing

Feed auth modes:
  azureauth (default) — tokenHelper using the azureauth CLI. Acquires an Entra ID
      token for Azure DevOps, cached and silently refreshed via the OS broker
      (WAM). No PAT stored, no rotation, CAE handled. Requires azureauth
      (https://aka.ms/azureauth).
  pat — mint a rotating Azure DevOps PAT (Packaging read), Basic auth in
      ~/.npmrc. Org policy may cap its lifetime; re-run to rotate.
  token-helper — az-backed tokenHelper; auto-refreshes but is CAE-fragile and
      needs an interactive 'az login' when the session is revoked.
`);
}

const commands = ["push", "pull", "help"];
(async () => {
    const command = commands.includes(process.argv[2])
        ? process.argv[2]
        : undefined;
    const start = command !== undefined ? 3 : 2;
    for (let i = start; i < process.argv.length; i++) {
        const arg = process.argv[i];
        if (arg === "--vault") {
            paramVault = process.argv[++i];
            if (paramVault === undefined) {
                throw new Error("Missing value for --vault");
            }
            continue;
        }
        if (arg === "--secret") {
            paramSecret = process.argv[++i];
            if (paramSecret === undefined) {
                throw new Error("Missing value for --secret");
            }
            continue;
        }
        if (arg === "--auth") {
            paramAuthMode = process.argv[++i];
            if (paramAuthMode === undefined) {
                throw new Error(
                    "Missing value for --auth (pat | token-helper)",
                );
            }
            authModeExplicit = true;
            continue;
        }
        if (arg === "--auth-only") {
            paramAuthOnly = true;
            continue;
        }
        if (arg === "--commit") {
            paramCommit = true;
            continue;
        }
        if (arg === "--dry-run") {
            paramCommit = false;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    switch (command) {
        case "push":
            await push();
            break;
        case "pull":
        case undefined:
            await pull();
            await seedCorepackPnpm();
            break;
        case "help":
            printHelp();
            break;
    }
})().catch((e) => {
    console.error(chalk.red(`FATAL ERROR: ${e.stack ?? e.message}`));
    process.exit(1);
});
