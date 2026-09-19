// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    REASONING_ALLOW_ONCE,
    REASONING_ALLOW_TOOL_REQUEST,
    REASONING_ALLOW_REQUEST,
    REASONING_ALLOW_TOOL_SESSION,
    REASONING_ALLOW_SESSION,
    REASONING_DENY,
    getReasoningPermissionChoices,
    getReasoningPermissionSessionApproval,
    hasCachedReasoningApproval,
    recordReasoningApprovalChoice,
    setReasoningPermissionSessionApproval,
    type ReasoningPermissionPolicyRequest,
} from "../src/reasoning/reasoningPermissionPolicy.js";

// Every host must expose a `session` object because the policy state is
// bound to that session, not the host container. Tests use fresh empty
// objects so each case starts from a clean slate.
function h(): { session: object } {
    return { session: {} };
}

function req(
    overrides: Partial<ReasoningPermissionPolicyRequest> = {},
): ReasoningPermissionPolicyRequest {
    return {
        requestId: "r1",
        permissionIdentity: "tool:example",
        cacheEligible: true,
        sessionEligible: true,
        blanketSessionEligible: true,
        ...overrides,
    };
}

describe("reasoningPermissionPolicy: session approval", () => {
    it("tracks blanket session approval per agent context", () => {
        const first = h();
        const second = h();
        expect(getReasoningPermissionSessionApproval(first)).toBe(false);
        setReasoningPermissionSessionApproval(first, true);
        expect(getReasoningPermissionSessionApproval(first)).toBe(true);
        expect(getReasoningPermissionSessionApproval(second)).toBe(false);
        setReasoningPermissionSessionApproval(first, false);
        expect(getReasoningPermissionSessionApproval(first)).toBe(false);
    });

    it("session reset clears both blanket flag and per-tool session grants", () => {
        const ctx = h();
        recordReasoningApprovalChoice(
            ctx,
            req({ permissionIdentity: "mcp:svc/tool" }),
            REASONING_ALLOW_TOOL_SESSION,
        );
        recordReasoningApprovalChoice(
            ctx,
            req({ permissionIdentity: "custom-tool:execute_action" }),
            REASONING_ALLOW_TOOL_SESSION,
        );
        setReasoningPermissionSessionApproval(ctx, true);
        expect(getReasoningPermissionSessionApproval(ctx)).toBe(true);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ permissionIdentity: "mcp:svc/tool" }),
            ),
        ).toBe(true);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ permissionIdentity: "custom-tool:execute_action" }),
            ),
        ).toBe(true);

        setReasoningPermissionSessionApproval(ctx, false);
        expect(getReasoningPermissionSessionApproval(ctx)).toBe(false);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ permissionIdentity: "mcp:svc/tool" }),
            ),
        ).toBe(false);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ permissionIdentity: "custom-tool:execute_action" }),
            ),
        ).toBe(false);
    });

    it("swapping the host's session object isolates grants and switching back restores them", () => {
        // The dispatcher replaces `CommandHandlerContext.session` on new-session
        // and restore-session flows. Grants recorded against the previous
        // Session must not carry over to the replacement, and switching back
        // to the original Session object must expose only its original grants.
        const sessionA = {};
        const sessionB = {};
        const host: { session: object } = { session: sessionA };

        recordReasoningApprovalChoice(
            host,
            req({ permissionIdentity: "mcp:svc/toolA" }),
            REASONING_ALLOW_TOOL_SESSION,
        );
        expect(
            hasCachedReasoningApproval(
                host,
                req({ permissionIdentity: "mcp:svc/toolA" }),
            ),
        ).toBe(true);

        host.session = sessionB;
        expect(
            hasCachedReasoningApproval(
                host,
                req({ permissionIdentity: "mcp:svc/toolA" }),
            ),
        ).toBe(false);
        recordReasoningApprovalChoice(
            host,
            req({ permissionIdentity: "mcp:svc/toolB" }),
            REASONING_ALLOW_TOOL_SESSION,
        );
        expect(
            hasCachedReasoningApproval(
                host,
                req({ permissionIdentity: "mcp:svc/toolB" }),
            ),
        ).toBe(true);

        host.session = sessionA;
        expect(
            hasCachedReasoningApproval(
                host,
                req({ permissionIdentity: "mcp:svc/toolA" }),
            ),
        ).toBe(true);
        expect(
            hasCachedReasoningApproval(
                host,
                req({ permissionIdentity: "mcp:svc/toolB" }),
            ),
        ).toBe(false);
    });
});

describe("reasoningPermissionPolicy: cached approval", () => {
    it("no cached approval by default", () => {
        expect(hasCachedReasoningApproval(h(), req())).toBe(false);
    });

    it("Allow once does not persist any state", () => {
        const ctx = h();
        recordReasoningApprovalChoice(ctx, req(), REASONING_ALLOW_ONCE);
        expect(hasCachedReasoningApproval(ctx, req())).toBe(false);
    });

    it("Allow this tool for request grants only the same request + identity", () => {
        const ctx = h();
        const r = req({ requestId: "r1", permissionIdentity: "shell:ls" });
        recordReasoningApprovalChoice(ctx, r, REASONING_ALLOW_TOOL_REQUEST);
        expect(hasCachedReasoningApproval(ctx, r)).toBe(true);
        expect(
            hasCachedReasoningApproval(ctx, {
                ...r,
                permissionIdentity: "shell:rm",
            }),
        ).toBe(false);
        expect(hasCachedReasoningApproval(ctx, { ...r, requestId: "r2" })).toBe(
            false,
        );
    });

    it("Allow all for request grants any identity in the same request", () => {
        const ctx = h();
        recordReasoningApprovalChoice(
            ctx,
            req({ requestId: "r1", permissionIdentity: "a" }),
            REASONING_ALLOW_REQUEST,
        );
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ requestId: "r1", permissionIdentity: "b" }),
            ),
        ).toBe(true);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ requestId: "r2", permissionIdentity: "a" }),
            ),
        ).toBe(false);
    });

    it("Allow this tool for session survives request boundaries", () => {
        const ctx = h();
        recordReasoningApprovalChoice(
            ctx,
            req({ requestId: "r1", permissionIdentity: "mcp:s/t" }),
            REASONING_ALLOW_TOOL_SESSION,
        );
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ requestId: "r2", permissionIdentity: "mcp:s/t" }),
            ),
        ).toBe(true);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ requestId: "r2", permissionIdentity: "mcp:s/other" }),
            ),
        ).toBe(false);
    });

    it("Allow all for session covers any eligible identity", () => {
        const ctx = h();
        recordReasoningApprovalChoice(ctx, req(), REASONING_ALLOW_SESSION);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({
                    requestId: "any",
                    permissionIdentity: "anything",
                }),
            ),
        ).toBe(true);
    });

    it("session grants isolate across agent contexts", () => {
        const a = h();
        const b = h();
        recordReasoningApprovalChoice(a, req(), REASONING_ALLOW_SESSION);
        expect(hasCachedReasoningApproval(a, req())).toBe(true);
        expect(hasCachedReasoningApproval(b, req())).toBe(false);
    });

    it("mandatory requests never consume caches or session grants", () => {
        const ctx = h();
        recordReasoningApprovalChoice(ctx, req(), REASONING_ALLOW_SESSION);
        recordReasoningApprovalChoice(
            ctx,
            req({ permissionIdentity: "mcp:s/t" }),
            REASONING_ALLOW_TOOL_SESSION,
        );
        expect(
            hasCachedReasoningApproval(ctx, req({ cacheEligible: false })),
        ).toBe(false);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({
                    permissionIdentity: "mcp:s/t",
                    cacheEligible: false,
                }),
            ),
        ).toBe(false);
    });

    it("blanket-session grant does not satisfy a request that forbids blanket-session", () => {
        // Sandbox-bypass in Copilot leaves per-request scopes eligible but
        // must not be auto-approved by the host's "Allow all for session"
        // flag. Model that by clearing blanketSessionEligible only.
        const ctx = h();
        recordReasoningApprovalChoice(ctx, req(), REASONING_ALLOW_SESSION);
        expect(
            hasCachedReasoningApproval(
                ctx,
                req({ blanketSessionEligible: false }),
            ),
        ).toBe(false);
    });
});

describe("reasoningPermissionPolicy: choice list", () => {
    it("returns only Allow once + Deny when the request is mandatory", () => {
        expect(
            getReasoningPermissionChoices(
                req({ cacheEligible: false, sessionEligible: false }),
            ),
        ).toEqual([REASONING_ALLOW_ONCE, REASONING_DENY]);
    });

    it("omits per-tool session when the SDK forbids it", () => {
        expect(
            getReasoningPermissionChoices(req({ sessionEligible: false })),
        ).toEqual([
            REASONING_ALLOW_ONCE,
            REASONING_ALLOW_TOOL_REQUEST,
            REASONING_ALLOW_REQUEST,
            REASONING_ALLOW_SESSION,
            REASONING_DENY,
        ]);
    });

    it("omits blanket session when blanket-session is not eligible", () => {
        expect(
            getReasoningPermissionChoices(
                req({ blanketSessionEligible: false }),
            ),
        ).toEqual([
            REASONING_ALLOW_ONCE,
            REASONING_ALLOW_TOOL_REQUEST,
            REASONING_ALLOW_REQUEST,
            REASONING_ALLOW_TOOL_SESSION,
            REASONING_DENY,
        ]);
    });

    it("returns the full ordered choice list when everything is eligible", () => {
        expect(getReasoningPermissionChoices(req())).toEqual([
            REASONING_ALLOW_ONCE,
            REASONING_ALLOW_TOOL_REQUEST,
            REASONING_ALLOW_REQUEST,
            REASONING_ALLOW_TOOL_SESSION,
            REASONING_ALLOW_SESSION,
            REASONING_DENY,
        ]);
    });
});

describe("reasoningPermissionPolicy: recordReasoningApprovalChoice", () => {
    it("returns true for Allow choices and false for Deny/unknown", () => {
        const ctx = h();
        expect(
            recordReasoningApprovalChoice(ctx, req(), REASONING_ALLOW_ONCE),
        ).toBe(true);
        expect(recordReasoningApprovalChoice(ctx, req(), REASONING_DENY)).toBe(
            false,
        );
        expect(recordReasoningApprovalChoice(ctx, req(), "Bogus")).toBe(false);
    });

    it("ignores session grants when session scopes are not eligible", () => {
        const ctx = h();
        const request = req({ sessionEligible: false });
        expect(
            recordReasoningApprovalChoice(
                ctx,
                request,
                REASONING_ALLOW_TOOL_SESSION,
            ),
        ).toBe(false);
        expect(hasCachedReasoningApproval(ctx, request)).toBe(false);
    });

    it("ignores blanket session grant when blanket-session is not eligible", () => {
        const ctx = h();
        recordReasoningApprovalChoice(
            ctx,
            req({ blanketSessionEligible: false }),
            REASONING_ALLOW_SESSION,
        );
        expect(getReasoningPermissionSessionApproval(ctx)).toBe(false);
    });
});
