// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Provider-neutral permission policy shared by all reasoning SDK adapters
// (Copilot, Claude, and any future provider). Each adapter normalizes its
// SDK permission request into a `ReasoningPermissionPolicyRequest` and then
// routes state (cached approvals, session grants, scope choices) through
// this module. Keeping the policy provider-agnostic ensures behavior parity
// across providers and gives the `@allow` command a single source of truth
// for what can actually be revoked host-side.

// Choice labels are the exact strings the host renders in the permission
// popup. They double as the wire protocol between the host and the webview,
// so they must stay in this module and must not be duplicated in adapters.
export const REASONING_ALLOW_ONCE = "Allow once";
export const REASONING_ALLOW_TOOL_REQUEST = "Allow this tool for request";
export const REASONING_ALLOW_REQUEST = "Allow all for request";
export const REASONING_ALLOW_TOOL_SESSION = "Allow this tool for session";
export const REASONING_ALLOW_SESSION = "Allow all for session";
export const REASONING_DENY = "Deny";

// Normalized adapter input. Adapters translate their SDK's permission request
// into this shape so the policy never needs SDK-specific knowledge.
export type ReasoningPermissionPolicyRequest = {
    // The dispatcher-level request identity. Scoping "for request" grants to
    // this value ensures grants clear at the end of the current dispatcher
    // request even when the reasoning SDK issues many tool calls per turn.
    requestId: string;

    // Stable identity for the specific tool/operation, e.g.
    // `mcp:svc/tool` or `claude:Bash`. Used as the key for both per-tool
    // request grants and per-tool session grants.
    permissionIdentity: string;

    // True when the adapter has verified the request is eligible for
    // session-scoped grants. Managed-policy prompts and sandbox-bypass
    // prompts must set this to false so no session scopes are offered
    // and no session-scoped cache lookups succeed.
    sessionEligible: boolean;

    // Also gates blanket "Allow all for session" for cases where per-tool
    // session grants are unavailable (e.g. Copilot shell requests do not
    // offer per-tool session, but do accept "all for session").
    blanketSessionEligible: boolean;

    // False when the adapter has determined the request must be shown to
    // the user unconditionally (managed policy, sandbox bypass). In that
    // mode `hasCachedApproval` always returns false and only "Allow once"
    // and "Deny" are offered.
    cacheEligible: boolean;
};

type SessionState = {
    blanketSession: boolean;
    blanketRequestId?: string;
    toolRequest?: { requestId: string; identities: Set<string> };
    toolSession: Set<string>;
};

// Bind approvals to the active TypeAgent Session so switching sessions cannot
// carry grants into another conversation.
export type ReasoningPermissionHost = { session: object };

const state = new WeakMap<object, SessionState>();

function getOrCreateState(host: ReasoningPermissionHost): SessionState {
    let s = state.get(host.session);
    if (s === undefined) {
        s = { blanketSession: false, toolSession: new Set<string>() };
        state.set(host.session, s);
    }
    return s;
}

export function getReasoningPermissionSessionApproval(
    host: ReasoningPermissionHost,
): boolean {
    return state.get(host.session)?.blanketSession === true;
}

// Called by the `@allow` command. Enabling only sets the blanket flag;
// disabling must revoke every session-scoped grant the host can actually
// revoke (blanket + per-tool session), matching the user's mental model of
// "back to prompting me again". Request-scoped grants intentionally survive
// because they are tied to the currently executing dispatcher request.
export function setReasoningPermissionSessionApproval(
    host: ReasoningPermissionHost,
    enabled: boolean,
): void {
    const s = getOrCreateState(host);
    if (enabled) {
        s.blanketSession = true;
    } else {
        s.blanketSession = false;
        s.toolSession.clear();
    }
}

export function hasCachedReasoningApproval(
    host: ReasoningPermissionHost,
    request: ReasoningPermissionPolicyRequest,
): boolean {
    if (!request.cacheEligible) {
        return false;
    }
    const s = state.get(host.session);
    if (s === undefined) {
        return false;
    }
    if (request.blanketSessionEligible && s.blanketSession) {
        return true;
    }
    if (s.blanketRequestId === request.requestId) {
        return true;
    }
    if (
        s.toolRequest?.requestId === request.requestId &&
        s.toolRequest.identities.has(request.permissionIdentity)
    ) {
        return true;
    }
    if (s.toolSession.has(request.permissionIdentity)) {
        return true;
    }
    return false;
}

// Return the ordered scope choices offered for this request. Adapters use
// this list as-is when calling `clientIO.question` so labels stay in sync
// with the webview and with `recordReasoningApprovalChoice`.
export function getReasoningPermissionChoices(
    request: ReasoningPermissionPolicyRequest,
): string[] {
    if (!request.cacheEligible) {
        // Mandatory prompts: managed policy or sandbox bypass. No caching,
        // no session scopes, no request scopes - the user must decide each
        // time.
        return [REASONING_ALLOW_ONCE, REASONING_DENY];
    }
    const choices: string[] = [
        REASONING_ALLOW_ONCE,
        REASONING_ALLOW_TOOL_REQUEST,
        REASONING_ALLOW_REQUEST,
    ];
    if (request.sessionEligible) {
        choices.push(REASONING_ALLOW_TOOL_SESSION);
    }
    if (request.blanketSessionEligible) {
        choices.push(REASONING_ALLOW_SESSION);
    }
    choices.push(REASONING_DENY);
    return choices;
}

// Interpret the user's chosen label and update policy state. Returns whether
// the choice grants access ("allow") or denies it. Idempotent; safe to call
// on a cache hit path with `REASONING_ALLOW_ONCE`.
export function recordReasoningApprovalChoice(
    host: ReasoningPermissionHost,
    request: ReasoningPermissionPolicyRequest,
    choice: string,
): boolean {
    switch (choice) {
        case REASONING_ALLOW_ONCE:
            return true;
        case REASONING_ALLOW_TOOL_REQUEST: {
            if (!request.cacheEligible) return false;
            const s = getOrCreateState(host);
            if (s.toolRequest?.requestId !== request.requestId) {
                s.toolRequest = {
                    requestId: request.requestId,
                    identities: new Set<string>(),
                };
            }
            s.toolRequest.identities.add(request.permissionIdentity);
            return true;
        }
        case REASONING_ALLOW_REQUEST: {
            if (!request.cacheEligible) return false;
            const s = getOrCreateState(host);
            s.blanketRequestId = request.requestId;
            return true;
        }
        case REASONING_ALLOW_TOOL_SESSION: {
            if (!request.cacheEligible || !request.sessionEligible)
                return false;
            const s = getOrCreateState(host);
            s.toolSession.add(request.permissionIdentity);
            return true;
        }
        case REASONING_ALLOW_SESSION: {
            if (!request.cacheEligible || !request.blanketSessionEligible)
                return false;
            const s = getOrCreateState(host);
            s.blanketSession = true;
            return true;
        }
        case REASONING_DENY:
            return false;
        default:
            // Unknown label: treat as deny rather than silently allowing.
            return false;
    }
}
