// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Shared readiness/setup helpers for the calendar and email agents.
// Both agents speak to Microsoft Graph (or Google) through the same provider
// abstraction in this package, gated on the same settings, and want the same
// "configured? signed-in?" state machine. This module factors that decision
// out so both agents stay thin wrappers — see the desktop agent's readiness.ts
// for the pattern this mirrors.

import type { ReadinessReport } from "@typeagent/agent-sdk";
import { configSetupHint } from "@typeagent/config";

export type GraphAgentName = "calendar" | "email";

// Inputs for the readiness decision. All three slots are independent so the
// pure evaluator can be unit-tested without env or provider mocking.
export type GraphReadinessProbe = {
    // True when MS Graph is configured (CLIENTID or TENANTID set — same
    // permissive check the existing detectConfiguredProvider uses, so
    // partial config still routes here for a useful error rather than
    // silently failing later).
    msGraphConfigured: boolean;
    // True when both Google client id AND secret are set (Google requires
    // both, unlike MS Graph which can fall back to device code with just
    // the public client id).
    googleConfigured: boolean;
    // True when a provider was instantiated AND its isAuthenticated()
    // returned true. Combine the two cases — "no provider" and "provider
    // but unauthenticated" surface the same way to the user.
    isAuthenticated: boolean;
    // Provider name actually selected for the active session, when known.
    // Used only for nicer messaging ("Microsoft 365" vs "Google"); the
    // decision logic doesn't depend on it.
    providerName: string | undefined;
};

// Cheap env probe — pulls just the booleans the evaluator needs.
// Mirrors `detectConfiguredProvider` / `isProviderConfigured` from the
// existing factory modules, kept in one place for readiness so the agent
// can call it without instantiating a provider.
export function probeGraphConfig(env: NodeJS.ProcessEnv): {
    msGraphConfigured: boolean;
    googleConfigured: boolean;
} {
    return {
        msGraphConfigured: !!(
            env.MSGRAPH_APP_CLIENTID || env.MSGRAPH_APP_TENANTID
        ),
        googleConfigured: !!(
            env.GOOGLE_CALENDAR_CLIENT_ID && env.GOOGLE_CALENDAR_CLIENT_SECRET
        ),
    };
}

// The "no provider configured" instructions, shared by the readiness
// report and by the agents' own login/setup paths so both point at the
// same YAML keys.
export function graphProviderSetupHint(agentName: GraphAgentName): string {
    return [
        "Microsoft Graph (Outlook / Microsoft 365):",
        "",
        configSetupHint(["MSGRAPH_APP_CLIENTID", "MSGRAPH_APP_TENANTID"]),
        "",
        "OR Google:",
        "",
        configSetupHint([
            "GOOGLE_CALENDAR_CLIENT_ID",
            "GOOGLE_CALENDAR_CLIENT_SECRET",
        ]),
        "",
        `Then run \`@config agent refresh ${agentName}\`.`,
    ].join("\n");
}

// Pure decision: probe → ReadinessReport.
//
// Three states, in order of severity:
//   - No provider configured at all → "setup-required" with a config hint.
//     This is a manual-config case (edit config.local.yaml, then refresh);
//     the `setup` hook can't help.
//   - Configured but not signed in → "setup-required" with sign-in hint.
//     The `setup` hook CAN drive this — it kicks off the device-code or
//     OAuth flow via the existing provider.login() path.
//   - Authenticated → "ready".
export function evaluateGraphReadiness(
    agentName: GraphAgentName,
    probe: GraphReadinessProbe,
): ReadinessReport {
    const Agent = agentName[0].toUpperCase() + agentName.slice(1);

    if (!probe.msGraphConfigured && !probe.googleConfigured) {
        return {
            state: "setup-required",
            message: `${Agent} agent has no provider configured.`,
            details: graphProviderSetupHint(agentName),
        };
    }

    if (!probe.isAuthenticated) {
        const providerLabel =
            probe.providerName === "google"
                ? "Google"
                : probe.providerName === "microsoft"
                  ? "Microsoft 365"
                  : "the configured provider";
        return {
            state: "setup-required",
            message: `${Agent} agent is configured (${probe.providerName ?? "unknown"}) but not signed in.`,
            details: `Run \`@config agent setup ${agentName}\` to start the ${providerLabel} sign-in flow, or \`@${agentName} login\` directly.`,
        };
    }

    return { state: "ready" };
}
