// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    buildCopilotAvailableTools,
    COPILOT_NATIVE_BUILTIN_TOOLS,
} from "../src/reasoning/copilot.js";

describe("Copilot availableTools allowlist", () => {
    it("uses source-qualified `builtin:` filters so only host-registered built-ins match", () => {
        for (const entry of COPILOT_NATIVE_BUILTIN_TOOLS) {
            expect(entry.startsWith("builtin:")).toBe(true);
            const name = entry.slice("builtin:".length);
            expect(name).toMatch(/^[a-zA-Z0-9_-]+$|^\*$/);
        }
    });

    it("advertises the native tools the merge-conflict resolution action depends on", () => {
        expect(COPILOT_NATIVE_BUILTIN_TOOLS).toEqual(
            expect.arrayContaining([
                "builtin:view",
                "builtin:edit",
                "builtin:create",
                "builtin:glob",
                "builtin:grep",
            ]),
        );
        expect(COPILOT_NATIVE_BUILTIN_TOOLS).toEqual(
            expect.arrayContaining(["builtin:powershell", "builtin:bash"]),
        );
    });

    it("does not include obsolete `github/fs/*`, `github/search/*`, or bare `shell` patterns", () => {
        for (const obsolete of [
            "github/fs/*",
            "github/search/*",
            "shell",
            "builtin:github/fs/*",
            "builtin:github/search/*",
            "builtin:shell",
        ]) {
            expect(COPILOT_NATIVE_BUILTIN_TOOLS).not.toContain(obsolete);
        }
    });

    it("includes model-specific editors and shell output and cancellation tools", () => {
        expect(COPILOT_NATIVE_BUILTIN_TOOLS).toEqual(
            expect.arrayContaining([
                "builtin:apply_patch",
                "builtin:str_replace_editor",
                "builtin:rg",
                "builtin:read_powershell",
                "builtin:stop_powershell",
                "builtin:list_powershell",
                "builtin:read_bash",
                "builtin:stop_bash",
                "builtin:list_bash",
                "builtin:web_fetch",
            ]),
        );
    });

    it("composes custom tools, subagent tools (when enabled), and native built-ins", () => {
        const withoutSubagents = buildCopilotAvailableTools({
            subagentsEnabled: false,
        });
        const withSubagents = buildCopilotAvailableTools({
            subagentsEnabled: true,
        });

        for (const custom of [
            "discover_actions",
            "execute_action",
            "search_memory",
            "get_user_context",
            "ask_user",
            "ask_user_form",
            "find_installable_agent",
        ]) {
            expect(withoutSubagents).toContain(custom);
            expect(withSubagents).toContain(custom);
        }

        for (const builtin of COPILOT_NATIVE_BUILTIN_TOOLS) {
            expect(withoutSubagents).toContain(builtin);
            expect(withSubagents).toContain(builtin);
        }

        const subagentTools = [
            "create_subagent",
            "invoke_subagent",
            "list_subagents",
            "stop_subagent",
        ];
        for (const s of subagentTools) {
            expect(withoutSubagents).not.toContain(s);
            expect(withSubagents).toContain(s);
        }
    });

    it("returns a fresh array each call so callers cannot mutate the source constants", () => {
        const first = buildCopilotAvailableTools({ subagentsEnabled: true });
        first.pop();
        const second = buildCopilotAvailableTools({ subagentsEnabled: true });
        expect(second.length).toBeGreaterThan(first.length);
    });
});
