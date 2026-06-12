// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Capability-token side channel for the Studio service WebSocket.
 *
 * The `studio` agent's WS server binds to loopback on an OS-assigned port and is
 * Origin-gated, but any local process could otherwise dial that port. As a
 * defense-in-depth capability check (the "loopback + token" model, like
 * Jupyter), the agent mints a random token per bound server and writes it to a
 * per-port file under the user's `~/.typeagent/studio/` directory; the
 * `typeagent-studio` extension reads it and presents it as an
 * `Authorization: Bearer <token>` header on connect.
 *
 * The file is **per-port** (`service-token-<port>.json`) so two agent-server
 * processes don't clobber each other's token (`discoverPort` is last-writer-wins
 * on the port, but each server owns its own token file). It is **not** a defense
 * against same-user code (which can read the file) — that is the accepted line,
 * matching the loopback+token model.
 *
 * Lives in `@typeagent/core` because it is the only package shared by both the
 * agent (server) and the extension (client). It uses only node `fs`/`path`/
 * `os`/`crypto` — no transport dependency — so core stays agent-rpc-free.
 */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";

/** Tokens are 32 random bytes rendered as 64 lowercase hex chars. */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Directory holding the per-port Studio service token files. */
function studioServiceDir(): string {
    return path.join(os.homedir(), ".typeagent", "studio");
}

/** Absolute path of the token file for a given bound port. */
export function getStudioServiceTokenPath(port: number): string {
    return path.join(studioServiceDir(), `service-token-${port}.json`);
}

/** Mint a fresh capability token. */
export function generateStudioServiceToken(): string {
    return randomBytes(32).toString("hex");
}

/** True if `token` has the exact expected shape (64 lowercase hex chars). */
export function isValidStudioServiceTokenFormat(token: string): boolean {
    return TOKEN_PATTERN.test(token);
}

/**
 * Constant-time compare of a presented token against the expected one. Both must
 * be well-formed; a format mismatch returns false without invoking
 * `timingSafeEqual` (which throws on unequal lengths).
 */
export function studioServiceTokenMatches(
    presented: string | undefined,
    expected: string,
): boolean {
    if (presented === undefined) {
        return false;
    }
    if (
        !isValidStudioServiceTokenFormat(presented) ||
        !isValidStudioServiceTokenFormat(expected)
    ) {
        return false;
    }
    const a = Buffer.from(presented, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length) {
        return false;
    }
    return timingSafeEqual(a, b);
}

/**
 * Write the token for `port`, creating `~/.typeagent/studio/` (private where the
 * platform supports it) and tightening the file to owner-only. Removes any
 * pre-existing file first so stale, possibly world-readable perms aren't
 * preserved. Throws on failure — the caller should treat a server it can't
 * write a token for as unusable.
 */
export async function writeStudioServiceToken(
    port: number,
    token: string,
): Promise<void> {
    const dir = studioServiceDir();
    await fs.mkdir(dir, { recursive: true });
    // Best-effort private dir (POSIX; Windows ignores the mode).
    try {
        await fs.chmod(dir, 0o700);
    } catch {
        // Non-fatal: directory perms are best-effort.
    }
    const file = getStudioServiceTokenPath(port);
    // Drop any stale file so a prior, broader mode isn't carried over.
    try {
        await fs.rm(file, { force: true });
    } catch {
        // Non-fatal.
    }
    await fs.writeFile(file, JSON.stringify({ port, token }), { mode: 0o600 });
    try {
        await fs.chmod(file, 0o600);
    } catch {
        // Non-fatal: Windows ignores the mode.
    }
}

/** Read the token for `port`, or `undefined` if absent/malformed. */
export async function readStudioServiceToken(
    port: number,
): Promise<string | undefined> {
    try {
        const raw = await fs.readFile(getStudioServiceTokenPath(port), "utf8");
        const parsed = JSON.parse(raw) as { token?: unknown };
        return typeof parsed.token === "string" &&
            isValidStudioServiceTokenFormat(parsed.token)
            ? parsed.token
            : undefined;
    } catch {
        return undefined;
    }
}

/** Remove the token file for `port` (best-effort). */
export async function clearStudioServiceToken(port: number): Promise<void> {
    try {
        await fs.rm(getStudioServiceTokenPath(port), { force: true });
    } catch {
        // Non-fatal: a stale token file is overwritten on the next bind.
    }
}
