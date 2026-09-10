// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { LOOPBACK_HOST } from "@typeagent/websocket-utils/loopback";

/**
 * Resolve the address the agent server listens on: `--host` wins over
 * `AGENT_SERVER_HOST`, and both fall back to loopback.
 *
 * Values are trimmed, and a blank one is treated as absent. Binding the empty
 * string publishes the listener on every interface, which is the opposite of
 * the default this function exists to enforce. An untrimmed value is worse
 * than useless: it fails to resolve at bind time, yet `isLoopbackHost` trims
 * before comparing, so it would read as loopback and suppress the
 * network-exposure warning for a host that never binds at all.
 */
export function resolveAgentServerHost(
    argv: readonly string[],
    env: NodeJS.ProcessEnv,
): string {
    const idx = argv.indexOf("--host");
    const fromArgv = idx !== -1 ? argv[idx + 1]?.trim() : undefined;
    const fromEnv = env.AGENT_SERVER_HOST?.trim();
    return fromArgv || fromEnv || LOOPBACK_HOST;
}
