// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildClaudePolicyRequest,
    formatClaudePermissionRequest,
    getClaudePermissionIdentity,
} from "../src/reasoning/claudePermission.js";
import {
    REASONING_ALLOW_ONCE,
    REASONING_DENY,
    getReasoningPermissionChoices,
} from "../src/reasoning/reasoningPermissionPolicy.js";

describe("Claude permission adapter: identity", () => {
    it("prefixes built-in tool names with `claude:`", () => {
        expect(getClaudePermissionIdentity("Read")).toBe("claude:Read");
        expect(getClaudePermissionIdentity("Bash")).toBe("claude:Bash");
    });

    it("normalizes MCP tools into the shared `mcp:<server>/<tool>` form", () => {
        expect(
            getClaudePermissionIdentity("mcp__action-executor__execute_action"),
        ).toBe("mcp:action-executor/execute_action");
    });

    it("keeps multi-segment MCP tool names intact after the first split", () => {
        expect(getClaudePermissionIdentity("mcp__svc__group__op")).toBe(
            "mcp:svc/group__op",
        );
    });

    it("falls back to the `claude:` form for malformed mcp prefixes", () => {
        expect(getClaudePermissionIdentity("mcp__onlyserver")).toBe(
            "claude:mcp__onlyserver",
        );
    });
});

describe("Claude permission adapter: policy request", () => {
    it("uses caches only when the SDK suggests a session allow rule matching this tool", () => {
        const r = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [{ toolName: "Bash" }],
                    },
                ],
            },
            "req-1",
        );
        expect(r).toEqual({
            requestId: "req-1",
            permissionIdentity: "claude:Bash",
            cacheEligible: true,
            sessionEligible: true,
            blanketSessionEligible: true,
        });
    });

    it("keeps indistinguishable permission escalations mandatory", () => {
        const r = buildClaudePolicyRequest("Bash", {}, "req-1");
        expect(r.cacheEligible).toBe(false);
        expect(r.sessionEligible).toBe(false);
        expect(r.blanketSessionEligible).toBe(false);
    });

    it("stays mandatory when no suggestion rule covers this tool", () => {
        // The SDK proposes a session-allow rule for Read, but the current
        // callback is for Bash. Nothing about the current tool has been
        // pre-approved, so the callback must be treated as mandatory.
        const r = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [{ toolName: "Read" }],
                    },
                ],
            },
            "req-1",
        );
        expect(r.cacheEligible).toBe(false);
        expect(r.sessionEligible).toBe(false);
        expect(r.blanketSessionEligible).toBe(false);
        // Different-tool suggestions must not influence the identity either.
        expect(r.permissionIdentity).toBe("claude:Bash");
    });
});

describe("Claude permission adapter: mandatory blockedPath", () => {
    it("blockedPath disables caches and every session/request scope", () => {
        const r = buildClaudePolicyRequest(
            "Bash",
            { blockedPath: "/etc/shadow" },
            "req-1",
        );
        expect(r.cacheEligible).toBe(false);
        expect(r.sessionEligible).toBe(false);
        expect(r.blanketSessionEligible).toBe(false);
    });

    it("mandatory prompts get only Allow once + Deny", () => {
        const r = buildClaudePolicyRequest(
            "Bash",
            { blockedPath: "/etc/shadow" },
            "req-1",
        );
        expect(getReasoningPermissionChoices(r)).toEqual([
            REASONING_ALLOW_ONCE,
            REASONING_DENY,
        ]);
    });
});

describe("Claude permission adapter: prompt formatting", () => {
    it("uses the SDK title verbatim when present", () => {
        const message = formatClaudePermissionRequest(
            "Read",
            { file_path: "/tmp/x" },
            { title: "Claude wants to read /tmp/x" },
        );
        expect(message).toContain("Claude wants to read /tmp/x");
    });

    it("falls back to displayName when title is absent", () => {
        const message = formatClaudePermissionRequest(
            "Write",
            { file_path: "/tmp/x" },
            { displayName: "write file" },
        );
        expect(message).toContain("Claude wants to write file");
    });

    it("falls back to a synthesized sentence when neither title nor displayName is supplied", () => {
        const message = formatClaudePermissionRequest(
            "Bash",
            { command: "ls" },
            {},
        );
        expect(message).toContain("Claude wants to run tool 'Bash'");
    });

    it("bounds tool input so the prompt stays readable", () => {
        const message = formatClaudePermissionRequest(
            "Write",
            { file_path: "/tmp/x", contents: "y".repeat(20000) },
            {},
        );
        expect(message).toContain("(truncated)");
        expect(message.length).toBeLessThan(2000);
    });

    it("surfaces blockedPath and decisionReason so the user understands why the prompt appeared", () => {
        const message = formatClaudePermissionRequest(
            "Bash",
            { command: "cat /etc/shadow" },
            {
                blockedPath: "/etc/shadow",
                decisionReason: "outside allowed directories",
            },
        );
        expect(message).toContain("Blocked path: /etc/shadow");
        expect(message).toContain("outside allowed directories");
    });

    it("omits the Input section when no input was supplied", () => {
        const message = formatClaudePermissionRequest("TodoWrite", {}, {});
        expect(message).not.toContain("Input:");
    });
});

describe("Claude permission adapter: normal choice list", () => {
    it("returns the full ordered choice list for an ordinary Bash request", () => {
        const r = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [{ toolName: "Bash" }],
                    },
                ],
            },
            "req-1",
        );
        expect(getReasoningPermissionChoices(r)).toEqual([
            REASONING_ALLOW_ONCE,
            "Allow this tool for request",
            "Allow all for request",
            "Allow this tool for session",
            "Allow all for session",
            REASONING_DENY,
        ]);
    });
});

describe("Claude permission adapter: rule-scoped identity", () => {
    // Session allow suggestions used to collapse every future Bash into a
    // shared `claude:Bash` cache identity. These tests lock in the fix so
    // grants for `ls` cannot silently authorize an unrelated `rm -rf /`.

    it("uses the base identity for a rule with no ruleContent", () => {
        const r = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [{ toolName: "Bash" }],
                    },
                ],
            },
            "req-1",
        );
        expect(r.permissionIdentity).toBe("claude:Bash");
    });

    it("distinguishes different rule contents for the same tool", () => {
        const ls = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [{ toolName: "Bash", ruleContent: "ls" }],
                    },
                ],
            },
            "req-1",
        );
        const rm = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [{ toolName: "Bash", ruleContent: "rm -rf /" }],
                    },
                ],
            },
            "req-1",
        );
        expect(ls.permissionIdentity).not.toBe(rm.permissionIdentity);
        expect(ls.permissionIdentity).toMatch(/^claude:Bash#[0-9a-f]{16}$/);
        // Rule text must not leak into the identity string.
        expect(ls.permissionIdentity).not.toContain("ls");
        expect(rm.permissionIdentity).not.toContain("rm");
    });

    it("is stable when identical rules are supplied in different order", () => {
        const a = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [
                            { toolName: "Bash", ruleContent: "ls" },
                            { toolName: "Bash", ruleContent: "pwd" },
                        ],
                    },
                ],
            },
            "req-1",
        );
        const b = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [
                            { toolName: "Bash", ruleContent: "pwd" },
                            { toolName: "Bash", ruleContent: "ls" },
                        ],
                    },
                ],
            },
            "req-1",
        );
        expect(a.permissionIdentity).toBe(b.permissionIdentity);
    });

    it("nonmatching rules leave the request mandatory with no cache", () => {
        const r = buildClaudePolicyRequest(
            "Bash",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [
                            { toolName: "Read", ruleContent: "/tmp/**" },
                            { toolName: "Write", ruleContent: "/tmp/x" },
                        ],
                    },
                ],
            },
            "req-1",
        );
        expect(r.cacheEligible).toBe(false);
        expect(getReasoningPermissionChoices(r)).toEqual([
            REASONING_ALLOW_ONCE,
            REASONING_DENY,
        ]);
    });

    it("blockedPath forces mandatory even when a matching rule exists", () => {
        const r = buildClaudePolicyRequest(
            "Bash",
            {
                blockedPath: "/etc/shadow",
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [{ toolName: "Bash" }],
                    },
                ],
            },
            "req-1",
        );
        expect(r.cacheEligible).toBe(false);
        expect(r.sessionEligible).toBe(false);
        expect(r.blanketSessionEligible).toBe(false);
        expect(getReasoningPermissionChoices(r)).toEqual([
            REASONING_ALLOW_ONCE,
            REASONING_DENY,
        ]);
    });

    it("preserves MCP normalization and honors ruleContent for MCP tools", () => {
        const base = buildClaudePolicyRequest(
            "mcp__svc__op",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [{ toolName: "mcp__svc__op" }],
                    },
                ],
            },
            "req-1",
        );
        expect(base.permissionIdentity).toBe("mcp:svc/op");

        const scoped = buildClaudePolicyRequest(
            "mcp__svc__op",
            {
                suggestions: [
                    {
                        behavior: "allow",
                        destination: "session",
                        rules: [
                            { toolName: "mcp__svc__op", ruleContent: "arg=1" },
                        ],
                    },
                ],
            },
            "req-1",
        );
        expect(scoped.permissionIdentity).toMatch(/^mcp:svc\/op#[0-9a-f]{16}$/);
        expect(scoped.permissionIdentity).not.toBe(base.permissionIdentity);
    });
});
