// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
} from "@typeagent/agent-sdk";
import {
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
} from "@typeagent/agent-sdk/helpers/action";
import { GithubCliActions } from "./github-cliSchema.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
    };
}

async function initializeAgentContext(): Promise<unknown> {
    return {};
}

// Run a gh CLI command and return stdout. Throws on non-zero exit.
async function runGh(
    args: string[],
    timeoutMs = 30_000,
): Promise<string> {
    const { stdout } = await execFileAsync("gh", args, {
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
    });
    return stdout.trim();
}

// Build gh CLI args from an action name and parameters.
function buildArgs(
    action: TypeAgentAction<GithubCliActions>,
): string[] | undefined {
    const p = action.parameters as Record<string, unknown>;

    switch (action.actionName) {
        // ── Auth ──
        case "authLogin": {
            const args = ["auth", "login"];
            if (p.hostname) args.push("--hostname", String(p.hostname));
            if (p.web) args.push("--web");
            if (p.token) args.push("--with-token");
            return args;
        }
        case "authLogout": {
            const args = ["auth", "logout"];
            if (p.hostname) args.push("--hostname", String(p.hostname));
            return args;
        }
        case "authStatus": {
            const args = ["auth", "status"];
            if (p.hostname) args.push("--hostname", String(p.hostname));
            if (p.showToken) args.push("--show-token");
            return args;
        }

        // ── Browse ──
        case "browseRepo": {
            const args = ["browse"];
            if (p.branch) args.push("--branch", String(p.branch));
            if (p.commit) args.push("--commit", String(p.commit));
            if (p.tag) args.push("--tag", String(p.tag));
            args.push("--no-browser"); // return URL instead of opening
            return args;
        }
        case "browseIssue": {
            const args = ["browse"];
            if (p.number) args.push(String(p.number));
            args.push("--no-browser");
            return args;
        }
        case "browsePr": {
            const args = ["browse"];
            if (p.number) args.push(String(p.number));
            args.push("--no-browser");
            return args;
        }

        // ── Codespace ──
        case "codespaceCreate": {
            const args = ["codespace", "create"];
            if (p.repo) args.push("--repo", String(p.repo));
            if (p.branch) args.push("--branch", String(p.branch));
            if (p.location) args.push("--location", String(p.location));
            return args;
        }
        case "codespaceDelete": {
            const args = ["codespace", "delete"];
            if (p.name) args.push("--codespace", String(p.name));
            return args;
        }
        case "codespaceList":
            return ["codespace", "list"];

        // ── Gist ──
        case "gistCreate": {
            const args = ["gist", "create"];
            if (p.public) args.push("--public");
            if (p.description)
                args.push("--desc", String(p.description));
            return args;
        }
        case "gistDelete": {
            const args = ["gist", "delete"];
            if (p.id) args.push(String(p.id));
            return args;
        }
        case "gistList": {
            const args = ["gist", "list"];
            if (p.public) args.push("--public");
            return args;
        }

        // ── Issue ──
        case "issueCreate": {
            const args = ["issue", "create"];
            if (p.title) args.push("--title", String(p.title));
            if (p.body) args.push("--body", String(p.body));
            if (p.assignee) args.push("--assignee", String(p.assignee));
            if (p.label) args.push("--label", String(p.label));
            return args;
        }
        case "issueClose": {
            const args = ["issue", "close"];
            if (p.number) args.push(String(p.number));
            return args;
        }
        case "issueReopen": {
            const args = ["issue", "reopen"];
            if (p.number) args.push(String(p.number));
            return args;
        }
        case "issueList": {
            const args = ["issue", "list"];
            if (p.repo) args.push("--repo", String(p.repo));
            if (p.state) args.push("--state", String(p.state));
            if (p.label) args.push("--label", String(p.label));
            if (p.assignee) args.push("--assignee", String(p.assignee));
            if (p.limit) args.push("--limit", String(p.limit));
            return args;
        }
        case "issueView": {
            const args = ["issue", "view"];
            if (p.number) args.push(String(p.number));
            if (p.repo) args.push("--repo", String(p.repo));
            return args;
        }

        // ── Org ──
        case "orgList":
            return ["org", "list"];
        case "orgView": {
            const args = ["org", "view"];
            if (p.name) args.push(String(p.name));
            return args;
        }

        // ── PR ──
        case "prCreate": {
            const args = ["pr", "create"];
            if (p.title) args.push("--title", String(p.title));
            if (p.body) args.push("--body", String(p.body));
            if (p.base) args.push("--base", String(p.base));
            if (p.head) args.push("--head", String(p.head));
            return args;
        }
        case "prClose": {
            const args = ["pr", "close"];
            if (p.number) args.push(String(p.number));
            return args;
        }
        case "prMerge": {
            const args = ["pr", "merge"];
            if (p.number) args.push(String(p.number));
            if (p.mergeMethod)
                args.push(`--${String(p.mergeMethod)}`);
            return args;
        }
        case "prList": {
            const args = ["pr", "list"];
            if (p.repo) args.push("--repo", String(p.repo));
            if (p.state) args.push("--state", String(p.state));
            if (p.label) args.push("--label", String(p.label));
            if (p.assignee) args.push("--assignee", String(p.assignee));
            if (p.limit) args.push("--limit", String(p.limit));
            return args;
        }
        case "prView": {
            const args = ["pr", "view"];
            if (p.number) args.push(String(p.number));
            if (p.repo) args.push("--repo", String(p.repo));
            return args;
        }

        // ── Project ──
        case "projectCreate": {
            const args = ["project", "create"];
            if (p.name) args.push("--title", String(p.name));
            if (p.body) args.push("--body", String(p.body));
            return args;
        }
        case "projectDelete": {
            const args = ["project", "delete"];
            if (p.id) args.push(String(p.id));
            return args;
        }
        case "projectList":
            return ["project", "list"];

        // ── Release ──
        case "releaseCreate": {
            const args = ["release", "create"];
            if (p.tag) args.push(String(p.tag));
            if (p.title) args.push("--title", String(p.title));
            if (p.notes) args.push("--notes", String(p.notes));
            return args;
        }
        case "releaseDelete": {
            const args = ["release", "delete"];
            if (p.id) args.push(String(p.id));
            return args;
        }
        case "releaseList":
            return ["release", "list"];

        // ── Repo ──
        case "repoCreate": {
            const args = ["repo", "create"];
            if (p.name) args.push(String(p.name));
            if (p.description)
                args.push("--description", String(p.description));
            if (p.public) args.push("--public");
            if (p.private) args.push("--private");
            return args;
        }
        case "repoClone": {
            const args = ["repo", "clone"];
            if (p.repo) args.push(String(p.repo));
            if (p.branch)
                args.push("--", "--branch", String(p.branch));
            return args;
        }
        case "repoDelete": {
            const args = ["repo", "delete"];
            if (p.repo) args.push(String(p.repo));
            args.push("--yes");
            return args;
        }
        case "repoView": {
            const args = ["repo", "view"];
            if (p.repo) args.push(String(p.repo));
            args.push("--json", "name,owner,description,stargazerCount,forkCount,watchers,defaultBranchRef,createdAt,updatedAt,url,primaryLanguage,visibility");
            return args;
        }

        // ── Cache ──
        case "cacheList":
            return ["cache", "list"];
        case "cacheDelete": {
            const args = ["cache", "delete"];
            if (p.id) args.push(String(p.id));
            return args;
        }

        // ── Run / Workflow ──
        case "runView": {
            const args = ["run", "view"];
            if (p.id) args.push(String(p.id));
            return args;
        }
        case "workflowView": {
            const args = ["workflow", "view"];
            if (p.id) args.push(String(p.id));
            return args;
        }

        // ── Misc ──
        case "agentTaskRun": {
            const args = ["agent-task", "run"];
            if (p.task) args.push(String(p.task));
            return args;
        }
        case "aliasSet": {
            const args = ["alias", "set"];
            if (p.name) args.push(String(p.name));
            if (p.command) args.push(String(p.command));
            return args;
        }
        case "apiRequest": {
            const args = ["api"];
            if (p.endpoint) {
                let endpoint = String(p.endpoint);
                // If it looks like "owner/repo" (no leading slash, single slash),
                // assume /repos/{owner}/{repo}/contributors for contributor queries
                if (!endpoint.startsWith("/") && endpoint.split("/").length === 2) {
                    endpoint = `/repos/${endpoint}/contributors`;
                }
                args.push(endpoint);
            }
            if (p.method) args.push("--method", String(p.method));
            return args;
        }
        case "attestationCreate": {
            const args = ["attestation", "create"];
            if (p.artifact) args.push(String(p.artifact));
            if (p.type) args.push("--type", String(p.type));
            return args;
        }
        case "completionGenerate": {
            const args = ["completion"];
            if (p.shell) args.push("--shell", String(p.shell));
            return args;
        }
        case "configSet": {
            const args = ["config", "set"];
            if (p.name) args.push(String(p.name));
            if (p.value) args.push(String(p.value));
            return args;
        }
        case "copilotRun": {
            const args = ["copilot"];
            if (p.task) args.push(String(p.task));
            return args;
        }
        case "extensionInstall": {
            const args = ["extension", "install"];
            if (p.name) args.push(String(p.name));
            return args;
        }
        case "gpgKeyAdd": {
            const args = ["gpg-key", "add"];
            if (p.key) args.push(String(p.key));
            return args;
        }
        case "labelCreate": {
            const args = ["label", "create"];
            if (p.name) args.push(String(p.name));
            if (p.color) args.push("--color", String(p.color));
            return args;
        }
        case "licensesView":
            return ["repo", "license", "view"];
        case "previewExecute": {
            const args = ["preview"];
            if (p.feature) args.push(String(p.feature));
            return args;
        }
        case "rulesetView": {
            const args = ["ruleset", "view"];
            if (p.repo) args.push("--repo", String(p.repo));
            return args;
        }
        case "searchRepos": {
            const args = ["search", "repos"];
            if (p.query) args.push(String(p.query));
            return args;
        }
        case "secretCreate": {
            const args = ["secret", "set"];
            if (p.name) args.push(String(p.name));
            if (p.value) args.push("--body", String(p.value));
            return args;
        }
        case "sshKeyAdd": {
            const args = ["ssh-key", "add"];
            if (p.key) args.push(String(p.key));
            return args;
        }
        case "statusPrint":
            return ["status"];
        case "variableCreate": {
            const args = ["variable", "set"];
            if (p.name) args.push(String(p.name));
            if (p.value) args.push("--body", String(p.value));
            return args;
        }
        default:
            return undefined;
    }
}

function formatValue(v: unknown): string {
    if (v === null || v === undefined) return "—";
    if (typeof v === "object") {
        if (Array.isArray(v)) return v.map(formatValue).join(", ") || "—";
        const obj = v as Record<string, unknown>;
        if ("name" in obj) return String(obj.name);
        if ("login" in obj) return String(obj.login);
        if ("totalCount" in obj) return String(obj.totalCount);
        return JSON.stringify(v);
    }
    return String(v);
}

// Return a focused, natural-language answer for a specific repo field.
function distillRepoField(
    field: string,
    data: Record<string, unknown>,
    repo: string,
): string | undefined {
    const label = repo || formatValue(data.owner) + "/" + data.name;
    switch (field) {
        case "stars":
            return `⭐ **${label}** has **${data.stargazerCount?.toLocaleString?.() ?? data.stargazerCount}** stars.`;
        case "forks":
            return `🍴 **${label}** has **${data.forkCount?.toLocaleString?.() ?? data.forkCount}** forks.`;
        case "language":
            return `💻 **${label}** is primarily written in **${formatValue(data.primaryLanguage)}**.`;
        case "watchers":
            return `👀 **${label}** has **${formatValue(data.watchers)}** watchers.`;
        case "description":
            return `📋 **${label}**: ${data.description}`;
        default:
            return undefined;
    }
}

async function executeAction(
    action: TypeAgentAction<GithubCliActions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    const args = buildArgs(action);
    if (!args) {
        return createActionResultFromTextDisplay(
            `Unknown action: ${action.actionName}`,
        );
    }

    const p = action.parameters as Record<string, unknown>;

    try {
        const output = await runGh(args);
        if (!output) {
            return createActionResultFromTextDisplay(
                `\`gh ${args.join(" ")}\` completed with no output.`,
            );
        }

        // Format JSON output from --json flag nicely
        if (args.includes("--json")) {
            try {
                const data = JSON.parse(output);

                // If a specific field was requested, return a focused answer
                if (p.field) {
                    const answer = distillRepoField(
                        String(p.field),
                        data,
                        String(p.repo ?? data.name ?? ""),
                    );
                    if (answer) {
                        return createActionResultFromMarkdownDisplay(answer);
                    }
                }

                const lines = Object.entries(data)
                    .map(([k, v]) => `- **${k}**: ${formatValue(v)}`)
                    .join("\n");
                return createActionResultFromMarkdownDisplay(
                    `**\`gh ${args.slice(0, args.indexOf("--json")).join(" ")}\`**\n\n${lines}`,
                );
            } catch {
                // Fall through to raw output
            }
        }

        // Format JSON arrays (e.g., API contributor responses)
        if (output.startsWith("[")) {
            try {
                const arr = JSON.parse(output) as Record<string, unknown>[];
                if (arr.length > 0 && "login" in arr[0]) {
                    const rows = arr
                        .slice(0, 20)
                        .map((u, i) => `${i + 1}. **${u.login}** — ${u.contributions} contributions`)
                        .join("\n");
                    return createActionResultFromMarkdownDisplay(
                        `**\`gh ${args.join(" ")}\`**\n\n${rows}`,
                    );
                }
            } catch {
                // Fall through to raw output
            }
        }

        return createActionResultFromMarkdownDisplay(
            `**\`gh ${args.join(" ")}\`**\n\n\`\`\`\n${output}\n\`\`\``,
        );
    } catch (err: any) {
        const stderr = err?.stderr ?? err?.message ?? String(err);
        return {
            error: `gh ${args.join(" ")} failed:\n${stderr}`,
        };
    }
}
