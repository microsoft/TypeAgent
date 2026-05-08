// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
    ActionResultSuccess,
    ReadinessReport,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResultFromError,
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import { GithubCliActions } from "./github-cliSchema.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
    SetupPlan,
    planGhSetupCommand,
    probeLinuxInstaller,
    runSetupCommand,
    whichExists,
} from "./setup.js";

const execFileAsync = promisify(execFile);

// Internal context — no per-action state, but we keep a per-process
// ChoiceManager for the setup yes/no card. Agents that don't use
// choices skip this; we need it because setup defers the actual
// install into a handleChoice callback.
type GithubCliActionContext = {
    choiceManager: ChoiceManager;
    // Mutex protecting the install pipeline. The dispatcher's
    // setup-window guard only covers the synchronous setup() call, not
    // the deferred work behind the yes/no card. Two clients each
    // confirming their own card before either install completes would
    // otherwise run winget / apt-get install in parallel.
    installInProgress: boolean;
};

export function instantiate(): AppAgent {
    return {
        initializeAgentContext,
        executeAction,
        checkReadiness,
        setup: async (actionContext) =>
            offerInstall(
                actionContext as ActionContext<GithubCliActionContext>,
            ),
        // Routes user yes/no responses (from createYesNoChoiceResult)
        // back to the registered ChoiceManager callback.
        handleChoice: async (choiceId, response, context) => {
            const ctx = (context as ActionContext<GithubCliActionContext>)
                .sessionContext.agentContext;
            return ctx.choiceManager.handleChoice(choiceId, response, context);
        },
    };
}

async function initializeAgentContext(): Promise<GithubCliActionContext> {
    return {
        choiceManager: new ChoiceManager(),
        installInProgress: false,
    };
}

// Outcome of the `gh auth status` probe — split out from the report so the
// decision logic can be unit-tested without spawning a subprocess.
//
//   ready          — gh exited 0; installed AND authenticated
//   not-installed  — execFile rejected with ENOENT; gh isn't on PATH
//   not-auth       — gh exited non-zero; installed but `gh auth status` failed
//                    (most commonly: not logged in)
//   probe-failed   — anything we couldn't classify (timeout, permission
//                    error, etc.) — surfaced as setup-required so the user
//                    gets a chance to investigate
export type GhProbeOutcome =
    | { kind: "ready" }
    | { kind: "not-installed" }
    | { kind: "not-auth"; stderr?: string }
    | { kind: "probe-failed"; message: string };

// Pure decision function — translates a probe outcome to a ReadinessReport.
// Mirrors the player/screencapture pattern. Exported for unit tests.
export function evaluateGhReadiness(outcome: GhProbeOutcome): ReadinessReport {
    switch (outcome.kind) {
        case "ready":
            return { state: "ready" };
        case "not-installed":
            return {
                state: "setup-required",
                message: "GitHub CLI (`gh`) not found on PATH.",
                details:
                    "Run `@config agent setup github-cli` to install via winget (Windows) / apt (Linux), or install manually from https://cli.github.com/ (e.g. `brew install gh` on macOS).",
            };
        case "not-auth":
            return {
                state: "setup-required",
                message: "GitHub CLI is installed but not authenticated.",
                details:
                    // No `setup` automation here — `gh auth login` is
                    // interactive (browser flow + paste-back code) and
                    // doesn't drive cleanly from chat.
                    "Run `gh auth login` in a terminal to authenticate, then `@config agent refresh github-cli`.",
            };
        case "probe-failed":
            return {
                state: "setup-required",
                message: `GitHub CLI readiness probe failed: ${outcome.message}`,
                details:
                    "Confirm `gh auth status` works in a terminal, then run `@config agent refresh github-cli`.",
            };
    }
}

// Spawns `gh auth status` once and classifies the result for
// evaluateGhReadiness. The dispatcher caches the report, so this runs at
// most once per session (plus on `@config agent refresh github-cli`).
//
// `gh auth status` does hit the network to validate the stored token, so
// this is on the heavy end of "cheap" per the AppAgent.checkReadiness
// contract — but it catches expired tokens, which a local-only check (e.g.
// `gh auth token`) would miss. The 10s timeout caps worst-case latency.
async function checkReadiness(): Promise<ReadinessReport> {
    try {
        await execFileAsync("gh", ["auth", "status"], {
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
            windowsHide: true,
        });
        return evaluateGhReadiness({ kind: "ready" });
    } catch (err: any) {
        // execFile uses err.code for both spawn errors (string like "ENOENT")
        // and non-zero exit (number). String → spawn failed; number → ran
        // and exited non-zero, which for `auth status` means not logged in.
        if (err?.code === "ENOENT") {
            return evaluateGhReadiness({ kind: "not-installed" });
        }
        if (typeof err?.code === "number") {
            return evaluateGhReadiness({
                kind: "not-auth",
                stderr: err?.stderr,
            });
        }
        return evaluateGhReadiness({
            kind: "probe-failed",
            message: err?.message ?? String(err),
        });
    }
}

// ============================================================================
// Setup — best-effort installer for `gh` (winget on Windows, apt on
// Linux). If the user is already authenticated this just confirms; if
// they're installed-but-not-authenticated, we surface a clear error
// pointing at `gh auth login` (we can't drive the browser flow from
// chat). The mutex pattern, HH:MM timestamping, and progress-noise
// filter mirror the screencapture agent.
// ============================================================================

// HH:MM timestamp prefix — same convention as screencapture / desktop
// / calendar / code so progress reads consistently across agents.
function ts(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Re-probes the environment to decide whether we should install (gh
// missing) or short-circuit (already installed → tell the user to
// `gh auth login` themselves). Returns the SetupPlan plus the
// already-handled state so the caller can surface the right message.
async function planGhInstall(): Promise<{
    plan: SetupPlan;
    alreadyInstalled: boolean;
}> {
    const ghOnPath = await whichExists("gh");
    if (ghOnPath) {
        return {
            alreadyInstalled: true,
            plan: { kind: "ok", commands: [] },
        };
    }
    if (process.platform !== "win32" && process.platform !== "linux") {
        return {
            alreadyInstalled: false,
            plan: {
                kind: "error",
                message: `Automated install for GitHub CLI is only supported on Windows and Linux. On ${process.platform}, install manually (e.g. \`brew install gh\` on macOS), then run \`@config agent refresh github-cli\`.`,
            },
        };
    }
    if (process.platform === "win32") {
        const wingetPresent = await whichExists("winget");
        return {
            alreadyInstalled: false,
            plan: planGhSetupCommand("windows", { wingetPresent }),
        };
    }
    const linux = await probeLinuxInstaller();
    return {
        alreadyInstalled: false,
        plan: planGhSetupCommand("linux", { linux }),
    };
}

// Builds the yes/no card that gates the install. Already-installed
// case short-circuits with an auth hint (we can't drive `gh auth
// login` from chat). Manual-install cases return a plain error so the
// dispatcher surfaces the install-instructions hint.
async function offerInstall(
    actionContext: ActionContext<GithubCliActionContext>,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;
    const { plan, alreadyInstalled } = await planGhInstall();

    if (alreadyInstalled) {
        return createActionResultFromTextDisplay(
            "GitHub CLI is already installed. If you're not authenticated, run `gh auth login` in a terminal, then `@config agent refresh github-cli`.",
        );
    }
    if (plan.kind === "error") {
        return createActionResultFromError(plan.message);
    }
    return offerYesNoCard(ctx, plan);
}

function offerYesNoCard(
    ctx: GithubCliActionContext,
    plan: SetupPlan & { kind: "ok" },
): ActionResultSuccess {
    const summary = plan.commands
        .map((c) => `  - ${c.argv.join(" ")}`)
        .join("\n");
    const prompt = [
        "Install GitHub CLI? The following will run:",
        summary,
        "",
        "Downloads can take 30–60 seconds (or longer on slow networks). I'll stream progress here and post a final message when it completes — no need to wait actively.",
        "",
        "After install you'll still need to authenticate by running `gh auth login` in a terminal (it's an interactive browser flow we can't drive from chat).",
    ].join("\n");
    return createYesNoChoiceResult(
        ctx.choiceManager,
        prompt,
        async (confirmed, liveActionContext) => {
            if (!confirmed) {
                return createActionResultFromTextDisplay(
                    "Install skipped. Run the commands manually, then `@config agent refresh github-cli`.",
                );
            }
            return runInstall(
                plan,
                liveActionContext as ActionContext<GithubCliActionContext>,
            );
        },
    );
}

// Runs after the user confirms the setup card. Lives in the
// handleChoice callback path — fresh ActionContext, displays go via
// actionIO.appendDisplay. Exported for unit tests.
export async function runInstall(
    plan: SetupPlan & { kind: "ok" },
    actionContext: ActionContext<GithubCliActionContext>,
): Promise<ActionResult> {
    const ctx = actionContext.sessionContext.agentContext;
    if (ctx.installInProgress) {
        return createActionResultFromError(
            "Install is already in progress (another client is running it). Wait for it to finish, then re-run `@config agent setup github-cli` if needed.",
        );
    }
    ctx.installInProgress = true;
    const overallStartMs = Date.now();

    try {
        const stepCount = plan.commands.length;
        if (stepCount > 0) {
            actionContext.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `[${ts()}] Starting install (${stepCount} step${stepCount === 1 ? "" : "s"}). I'll post here when it finishes — feel free to do other things in the meantime.`,
                    kind: "status",
                },
                "block",
            );
        }
        for (let i = 0; i < plan.commands.length; i++) {
            const cmd = plan.commands[i];
            const stepStartMs = Date.now();
            actionContext.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `[${ts()}] Step ${i + 1}/${stepCount}: ${cmd.description}…`,
                    kind: "status",
                },
                "block",
            );
            const { code, tail } = await runSetupCommand(cmd, (line) =>
                actionContext.actionIO.appendDisplay(
                    {
                        type: "text",
                        content: `[${ts()}] ${line}`,
                        kind: "status",
                    },
                    "inline",
                ),
            );
            const stepElapsed = Math.round((Date.now() - stepStartMs) / 1000);
            if (code !== 0) {
                // Linux apt failure most commonly means "gh not in
                // stock repos for this distro" — surface that hint
                // alongside the raw tail.
                const aptTail =
                    process.platform === "linux"
                        ? "\n\nIf the package wasn't found, your distro may not include `gh` in its default repos. See https://github.com/cli/cli/blob/trunk/docs/install_linux.md for instructions to add the GitHub apt repo, then re-run `@config agent setup github-cli`."
                        : "";
                return createActionResultFromError(
                    `[${ts()}] Install failed after ${stepElapsed}s (\`${cmd.argv[0]}\` exited with code ${code}). Last output:\n${tail}${aptTail}`,
                );
            }
            actionContext.actionIO.appendDisplay(
                {
                    type: "text",
                    content: `[${ts()}] ✓ Step ${i + 1}/${stepCount} complete (${stepElapsed}s).`,
                    kind: "status",
                },
                "block",
            );
        }
        const totalElapsed = Math.round((Date.now() - overallStartMs) / 1000);
        return createActionResultFromTextDisplay(
            `[${ts()}] Install complete in ${totalElapsed}s. Now authenticate by running \`gh auth login\` in a terminal — once that succeeds, the agent will pick up the auth state automatically on the next request (or run \`@config agent refresh github-cli\` to force a re-check).`,
        );
    } finally {
        ctx.installInProgress = false;
    }
}

// Run a gh CLI command and return stdout. Throws on non-zero exit.
async function runGh(args: string[], timeoutMs = 30_000): Promise<string> {
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
            if (p.description) args.push("--desc", String(p.description));
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
            if (p.repo) args.push("--repo", String(p.repo));
            if (p.title) args.push("--title", String(p.title));
            args.push("--body", p.body ? String(p.body) : "");
            if (p.assignee) args.push("--assignee", String(p.assignee));
            if (p.label) args.push("--label", String(p.label));
            return args;
        }
        case "issueClose": {
            const args = ["issue", "close"];
            if (p.number) args.push(String(p.number));
            if (p.repo) args.push("--repo", String(p.repo));
            return args;
        }
        case "issueReopen": {
            const args = ["issue", "reopen"];
            if (p.number) args.push(String(p.number));
            if (p.repo) args.push("--repo", String(p.repo));
            return args;
        }
        case "issueList": {
            const args = ["issue", "list"];
            if (p.repo) args.push("--repo", String(p.repo));
            if (p.state) args.push("--state", String(p.state));
            if (p.label) args.push("--label", String(p.label));
            if (p.assignee) args.push("--assignee", String(p.assignee));
            if (p.limit) args.push("--limit", String(p.limit));
            args.push("--json", "number,title,state,url,createdAt,labels");
            return args;
        }
        case "issueView": {
            const args = ["issue", "view"];
            if (p.number) args.push(String(p.number));
            if (p.repo) args.push("--repo", String(p.repo));
            args.push(
                "--json",
                "number,title,state,body,author,labels,assignees,comments,url,createdAt,closedAt",
            );
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
            args.push("--body", p.body ? String(p.body) : "");
            if (p.base) args.push("--base", String(p.base));
            if (p.head) args.push("--head", String(p.head));
            if (p.draft) args.push("--draft");
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
            if (p.mergeMethod) args.push(`--${String(p.mergeMethod)}`);
            return args;
        }
        case "prList": {
            const args = ["pr", "list"];
            if (p.repo) args.push("--repo", String(p.repo));
            if (p.state) args.push("--state", String(p.state));
            if (p.label) args.push("--label", String(p.label));
            if (p.assignee) args.push("--assignee", String(p.assignee));
            if (p.limit) args.push("--limit", String(p.limit));
            args.push(
                "--json",
                "number,title,state,url,createdAt,headRefName,isDraft",
            );
            return args;
        }
        case "prView": {
            const args = ["pr", "view"];
            if (p.number) args.push(String(p.number));
            if (p.repo) args.push("--repo", String(p.repo));
            args.push(
                "--json",
                "number,title,state,body,author,labels,url,createdAt,headRefName,baseRefName,isDraft,additions,deletions,changedFiles",
            );
            return args;
        }
        case "prCheckout": {
            const args = ["pr", "checkout"];
            if (p.number) args.push(String(p.number));
            if (p.branch) args.push("--branch", String(p.branch));
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
        case "releaseList": {
            const args = ["release", "list"];
            if (p.repo) args.push("--repo", String(p.repo));
            return args;
        }

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
            if (p.branch) args.push("--", "--branch", String(p.branch));
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
            args.push(
                "--json",
                "name,owner,description,stargazerCount,forkCount,watchers,defaultBranchRef,createdAt,updatedAt,url,primaryLanguage,visibility",
            );
            return args;
        }
        case "repoFork": {
            const args = ["repo", "fork"];
            if (p.repo) args.push(String(p.repo));
            if (p.name) args.push("--fork-name", String(p.name));
            args.push("--clone=false");
            return args;
        }
        case "starRepo": {
            if (p.unstar) {
                const args = ["api", "-X", "DELETE"];
                if (p.repo) args.push(`/user/starred/${String(p.repo)}`);
                return args;
            }
            const args = ["api", "-X", "PUT"];
            if (p.repo) args.push(`/user/starred/${String(p.repo)}`);
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
                if (
                    !endpoint.startsWith("/") &&
                    endpoint.split("/").length === 2
                ) {
                    endpoint = `/repos/${endpoint}/contributors`;
                }
                if (p.limit) {
                    const sep = endpoint.includes("?") ? "&" : "?";
                    endpoint += `${sep}per_page=${String(p.limit)}`;
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
            args.push(
                "--json",
                "fullName,description,stargazersCount,url,updatedAt",
            );
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
        case "dependabotAlerts": {
            // gh api /repos/{owner}/{repo}/dependabot/alerts
            let repo = p.repo ? String(p.repo) : "";
            if (!repo) return undefined;
            let endpoint = `/repos/${repo}/dependabot/alerts`;
            const params: string[] = [];
            if (p.severity) params.push(`severity=${String(p.severity)}`);
            if (p.state) params.push(`state=${String(p.state)}`);
            else params.push("state=open");
            if (params.length) endpoint += `?${params.join("&")}`;
            return ["api", endpoint];
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

// Format gh status output — parse the │-table into clean markdown sections
function formatStatusOutput(raw: string): string {
    const lines = raw.split("\n");

    const knownHeaders = new Set([
        "Assigned Issues",
        "Assigned Pull Requests",
        "Review Requests",
        "Mentions",
        "Repository Activity",
    ]);

    // gh status uses a two-column layout with │ separator, then a single-column section.
    const sections: Record<string, string[]> = {};
    let currentLeft = "";
    let currentRight = "";

    for (const line of lines) {
        if (!line.trim()) continue;

        if (line.includes("│")) {
            const [left, right] = line.split("│").map((s) => s.trim());

            if (left && knownHeaders.has(left)) currentLeft = left;
            if (right && knownHeaders.has(right)) currentRight = right;

            const leftIsHeader = left ? knownHeaders.has(left) : false;
            const rightIsHeader = right ? knownHeaders.has(right) : false;

            if (left && !leftIsHeader) {
                if (!currentLeft) currentLeft = "Activity";
                if (!sections[currentLeft]) sections[currentLeft] = [];
                sections[currentLeft].push(left);
            }
            if (right && !rightIsHeader) {
                if (!currentRight) currentRight = "Activity";
                if (!sections[currentRight]) sections[currentRight] = [];
                sections[currentRight].push(right);
            }
        } else {
            const trimmed = line.trim();
            if (trimmed && knownHeaders.has(trimmed)) {
                currentLeft = trimmed;
                currentRight = "";
            } else if (trimmed) {
                if (!currentLeft) currentLeft = "Activity";
                if (!sections[currentLeft]) sections[currentLeft] = [];
                sections[currentLeft].push(trimmed);
            }
        }
    }

    // Render as clean markdown
    const result: string[] = [];
    for (const [header, items] of Object.entries(sections)) {
        if (!header) continue;
        result.push(`**${header}**`);
        if (
            items.length === 0 ||
            (items.length === 1 && items[0].includes("Nothing here"))
        ) {
            result.push("  *Nothing here* 🎉\n");
            continue;
        }
        for (const item of items) {
            // Parse "owner/repo#123  description..." into a clickable link
            const match = item.match(/^(\S+\/\S+)#(\d+)\s+(.*)/);
            if (match) {
                const [, repo, num, desc] = match;
                const activity = desc.match(
                    /^(comment on|new PR|new issue)\s*(.*)/,
                );
                if (activity) {
                    const [, verb, rest] = activity;
                    const preview =
                        rest.length > 80 ? rest.slice(0, 80) + "…" : rest;
                    result.push(
                        `  - [${repo}#${num}](https://github.com/${repo}/issues/${num}) — *${verb}* ${preview}`,
                    );
                } else {
                    const preview =
                        desc.length > 80 ? desc.slice(0, 80) + "…" : desc;
                    result.push(
                        `  - [${repo}#${num}](https://github.com/${repo}/issues/${num}) ${preview}`,
                    );
                }
            } else {
                result.push(`  - ${item}`);
            }
        }
        result.push("");
    }
    return result.join("\n");
}

// Format a single issue view from JSON into rich markdown
function formatIssueView(data: Record<string, unknown>): string {
    const author = data.author ? formatValue(data.author) : "unknown";
    const labels = Array.isArray(data.labels)
        ? (data.labels as Record<string, unknown>[])
              .map((l) => `\`${l.name}\``)
              .join(" ")
        : "";
    const assignees = Array.isArray(data.assignees)
        ? (data.assignees as Record<string, unknown>[])
              .map((a) => formatValue(a))
              .join(", ")
        : "";
    const commentCount = Array.isArray(data.comments)
        ? data.comments.length
        : (data.comments ?? 0);
    const body = data.body ? String(data.body).slice(0, 1000) : "";
    const bodySection = body
        ? `\n\n---\n\n${body}${String(data.body).length > 1000 ? "\n\n*…truncated*" : ""}`
        : "";

    let header = `### [#${data.number} ${data.title}](${data.url})\n\n`;
    header += `**State:** ${data.state}`;
    header += ` · **Author:** ${author}`;
    if (labels) header += ` · **Labels:** ${labels}`;
    if (assignees) header += `\n**Assignees:** ${assignees}`;
    header += ` · **Comments:** ${commentCount}`;
    header += ` · **Created:** ${String(data.createdAt).slice(0, 10)}`;
    if (data.closedAt)
        header += ` · **Closed:** ${String(data.closedAt).slice(0, 10)}`;

    return header + bodySection;
}

// Format a single PR view from JSON into rich markdown
function formatPrView(data: Record<string, unknown>): string {
    const author = data.author ? formatValue(data.author) : "unknown";
    const labels = Array.isArray(data.labels)
        ? (data.labels as Record<string, unknown>[])
              .map((l) => `\`${l.name}\``)
              .join(" ")
        : "";
    const status = data.isDraft ? "DRAFT" : String(data.state);
    const body = data.body ? String(data.body).slice(0, 1000) : "";
    const bodySection = body
        ? `\n\n---\n\n${body}${String(data.body).length > 1000 ? "\n\n*…truncated*" : ""}`
        : "";

    let header = `### [#${data.number} ${data.title}](${data.url})\n\n`;
    header += `**State:** ${status}`;
    header += ` · **Author:** ${author}`;
    if (data.headRefName)
        header += ` · **Branch:** \`${data.headRefName}\` → \`${data.baseRefName}\``;
    if (labels) header += ` · **Labels:** ${labels}`;
    if (data.additions !== undefined) {
        header += `\n**Changes:** +${data.additions} −${data.deletions} across ${data.changedFiles} files`;
    }
    header += ` · **Created:** ${String(data.createdAt).slice(0, 10)}`;

    return header + bodySection;
}

function formatListResults(
    items: Record<string, unknown>[],
    actionName: string,
): string | undefined {
    if (items.length === 0) return "No results found.";

    // Issues
    if (actionName === "issueList" && "number" in items[0]) {
        return items
            .map((i) => {
                const labels = Array.isArray(i.labels)
                    ? (i.labels as Record<string, unknown>[])
                          .map((l) => l.name)
                          .join(", ")
                    : "";
                const labelStr = labels ? ` \`${labels}\`` : "";
                return `- [#${i.number} ${i.title}](${i.url}) — ${i.state}${labelStr}`;
            })
            .join("\n");
    }

    // Pull requests
    if (actionName === "prList" && "number" in items[0]) {
        return items
            .map((pr) => {
                const status = pr.isDraft ? "DRAFT" : String(pr.state);
                const branch = pr.headRefName ? ` \`${pr.headRefName}\`` : "";
                return `- [#${pr.number} ${pr.title}](${pr.url}) — ${status}${branch}`;
            })
            .join("\n");
    }

    // Search repos
    if (actionName === "searchRepos" && "fullName" in items[0]) {
        return items
            .map((r) => {
                const stars =
                    r.stargazersCount || r.stargazerCount
                        ? ` ⭐ ${r.stargazersCount ?? r.stargazerCount}`
                        : "";
                const desc = r.description ? ` — ${r.description}` : "";
                return `- [${r.fullName}](${r.url})${stars}${desc}`;
            })
            .join("\n");
    }

    return undefined;
}

// Friendly success messages for mutation actions that return no output
function getMutationSuccessMessage(
    action: TypeAgentAction<GithubCliActions>,
): string | undefined {
    const p = action.parameters as Record<string, unknown>;
    switch (action.actionName) {
        case "starRepo":
            return p.unstar
                ? `⭐ Unstarred **${p.repo}**.`
                : `⭐ Starred **${p.repo}**!`;
        case "repoFork":
            return `🍴 Forked **${p.repo}** to your account!`;
        case "prCheckout":
            return `✅ Checked out PR **#${p.number}** locally.`;
        case "issueClose":
            return `✅ Closed issue **#${p.number}**.`;
        case "issueReopen":
            return `✅ Reopened issue **#${p.number}**.`;
        case "prClose":
            return `✅ Closed PR **#${p.number}**.`;
        case "prMerge":
            return `✅ Merged PR **#${p.number}**!`;
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
            // Friendly success messages for write/mutation actions
            const msg = getMutationSuccessMessage(action);
            if (msg) {
                return createActionResultFromMarkdownDisplay(msg);
            }
            return createActionResultFromTextDisplay(
                `\`gh ${args.join(" ")}\` completed with no output.`,
            );
        }

        // Format JSON output from --json flag nicely
        if (args.includes("--json")) {
            try {
                const data = JSON.parse(output);
                const cmdLabel = `\`gh ${args.slice(0, args.indexOf("--json")).join(" ")}\``;

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

                // Array results: issues, PRs, search repos
                if (Array.isArray(data)) {
                    const rows = formatListResults(data, action.actionName);
                    if (rows) {
                        return createActionResultFromMarkdownDisplay(
                            `**${cmdLabel}** — ${data.length} result${data.length === 1 ? "" : "s"}\n\n${rows}`,
                        );
                    }
                }

                // Single issue view — rich formatted output
                if (action.actionName === "issueView" && "number" in data) {
                    return createActionResultFromMarkdownDisplay(
                        formatIssueView(data),
                    );
                }

                // Single PR view — rich formatted output
                if (action.actionName === "prView" && "number" in data) {
                    return createActionResultFromMarkdownDisplay(
                        formatPrView(data),
                    );
                }

                // Single object (e.g., repo view)
                const lines = Object.entries(data)
                    .map(([k, v]) => `- **${k}**: ${formatValue(v)}`)
                    .join("\n");
                return createActionResultFromMarkdownDisplay(
                    `**${cmdLabel}**\n\n${lines}`,
                );
            } catch {
                // Fall through to raw output
            }
        }

        // Format JSON arrays (e.g., API contributor responses, dependabot alerts)
        if (output.startsWith("[")) {
            try {
                const arr = JSON.parse(output) as Record<string, unknown>[];

                // Empty array — friendly message for dependabot/list actions
                if (arr.length === 0) {
                    if (action.actionName === "dependabotAlerts") {
                        return createActionResultFromMarkdownDisplay(
                            "✅ **No matching Dependabot alerts found!**",
                        );
                    }
                    return createActionResultFromTextDisplay(
                        "No results found.",
                    );
                }

                // Dependabot alerts
                if (arr.length > 0 && "security_advisory" in arr[0]) {
                    const rows = arr
                        .map((a) => {
                            const adv = a.security_advisory as Record<
                                string,
                                unknown
                            >;
                            const sev = String(
                                adv.severity ?? "unknown",
                            ).toUpperCase();
                            const pkg = a.dependency
                                ? (a.dependency as Record<string, unknown>)
                                      .package
                                    ? (
                                          (
                                              a.dependency as Record<
                                                  string,
                                                  unknown
                                              >
                                          ).package as Record<string, unknown>
                                      ).name
                                    : "unknown"
                                : "unknown";
                            const sevEmoji =
                                sev === "CRITICAL"
                                    ? "🔴"
                                    : sev === "HIGH"
                                      ? "🟠"
                                      : sev === "MEDIUM"
                                        ? "🟡"
                                        : "🟢";
                            return `- ${sevEmoji} **${sev}** — \`${pkg}\` — [${adv.summary}](${a.html_url})`;
                        })
                        .join("\n");
                    const header = `🔒 **${arr.length} Dependabot alert${arr.length === 1 ? "" : "s"}**`;
                    return createActionResultFromMarkdownDisplay(
                        `${header}\n\n${rows}`,
                    );
                }

                // Contributors
                if (arr.length > 0 && "login" in arr[0]) {
                    const rows = arr
                        .map(
                            (u, i) =>
                                `${i + 1}. [**${u.login}**](https://github.com/${u.login}) — ${u.contributions} contributions`,
                        )
                        .join("\n");
                    const header =
                        arr.length === 1
                            ? "Top contributor"
                            : `Top ${arr.length} contributors`;
                    return createActionResultFromMarkdownDisplay(
                        `**${header}**\n\n${rows}`,
                    );
                }
            } catch {
                // Fall through to raw output
            }
        }

        // Bold section headers in gh status output
        if (action.actionName === "statusPrint") {
            const formatted = formatStatusOutput(output);
            return createActionResultFromMarkdownDisplay(
                `**\`gh status\`**\n\n${formatted}`,
            );
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
