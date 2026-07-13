// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ActionContext,
    AppAgent,
    TypeAgentAction,
    ActionResult,
    ActionResultSuccess,
    ReadinessReport,
    BadgeTone,
    TableCell,
    TableBlock,
    KeyValuePair,
    StructuredBlock,
} from "@typeagent/agent-sdk";
import {
    ChoiceManager,
    createActionResultFromError,
    createActionResultFromTextDisplay,
    createActionResultFromMarkdownDisplay,
    createMultiChoiceResult,
    createYesNoChoiceResult,
} from "@typeagent/agent-sdk/helpers/action";
import {
    ColumnSpec,
    createStructuredContent,
    createTable,
} from "@typeagent/agent-sdk/helpers/display";
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

// Sentinel values that mean "no assignee". `gh issue list --assignee <x>`
// treats <x> as a literal GitHub login, so "--assignee none" fails with
// "Could not find an assignee with the login 'none'". The supported way to
// list unassigned items is the search qualifier `--search "no:assignee"`.
const UNASSIGNED_SENTINELS = new Set([
    "none",
    "unassigned",
    "nobody",
    "noone",
    "no one",
    "no-one",
]);

function isUnassignedAssignee(assignee: string): boolean {
    return UNASSIGNED_SENTINELS.has(
        assignee.trim().toLowerCase().replace(/^@/, ""),
    );
}

// Build args for `gh issue list` / `gh pr list`. `state`, `label`, and a
// concrete `assignee` map to the matching flags. "Unassigned" has no flag
// equivalent — `gh ... list --assignee none` treats "none" as a literal
// login and fails with "Could not find an assignee with the login 'none'" —
// so it maps to the `no:assignee` search qualifier instead.
//
// gh honors `--search` alongside `--state` and `--label`, so a request like
// "open unassigned issues labeled X" composes to
// `--state open --label X --search no:assignee` and filters on all three.
function buildListArgs(
    kind: "issue" | "pr",
    p: Record<string, unknown>,
    jsonFields: string,
): string[] {
    const args = [kind, "list"];
    if (p.repo) args.push("--repo", String(p.repo));
    if (p.state) args.push("--state", String(p.state));
    if (p.label) args.push("--label", String(p.label));

    const assignee = p.assignee ? String(p.assignee) : "";
    if (isUnassignedAssignee(assignee)) {
        args.push("--search", "no:assignee");
    } else if (assignee) {
        args.push("--assignee", assignee);
    }

    if (p.limit) args.push("--limit", String(p.limit));
    args.push("--json", jsonFields);
    return args;
}

// Build gh CLI args from an action name and parameters.
// code-complexity-allow: hand-written gh CLI arg marshaller; one branch per action
export function buildArgs(
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
        case "issueDelete": {
            const args = ["issue", "delete", String(p.number), "--yes"];
            if (p.repo) args.push("--repo", String(p.repo));
            return args;
        }
        case "issueReopen": {
            const args = ["issue", "reopen"];
            if (p.number) args.push(String(p.number));
            if (p.repo) args.push("--repo", String(p.repo));
            return args;
        }
        case "issueList":
            return buildListArgs(
                "issue",
                p,
                "number,title,state,url,createdAt,labels",
            );
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
        case "prList":
            return buildListArgs(
                "pr",
                p,
                "number,title,state,url,createdAt,headRefName,isDraft",
            );
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
        case "prChecks": {
            const args = ["pr", "checks", String(p.number)];
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
        case "issueAddLabel": {
            const args = ["issue", "edit", String(p.number)];
            if (p.label) args.push("--add-label", String(p.label));
            if (p.repo) args.push("--repo", String(p.repo));
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
        case "myAssignedIssues": {
            const limit = p.limit ?? 20;
            // gh search issues --assignee @me --state open --json …
            return [
                "search",
                "issues",
                "--assignee",
                "@me",
                "--state",
                "open",
                "--limit",
                String(limit),
                "--json",
                "number,title,url,repository,state,updatedAt,labels",
            ];
        }
        case "variableCreate": {
            const args = ["variable", "set"];
            if (p.name) args.push(String(p.name));
            if (p.value) args.push("--body", String(p.value));
            return args;
        }
        case "dependabotAlerts": {
            // gh api /repos/{owner}/{repo}/dependabot/alerts
            const repo = p.repo ? String(p.repo) : "";
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

// Build a focused structured answer for a specific repo field. Wraps the
// natural-language summary as a single-pair keyValue block plus a rawData
// payload carrying the raw field value. Returns undefined for unknown fields.
//
// Exported for unit tests.
export function buildStructuredField(
    field: string,
    data: Record<string, unknown>,
    repo: string,
): ActionResultSuccess | undefined {
    const summary = distillRepoField(field, data, repo);
    if (summary === undefined) {
        return undefined;
    }
    const label = repo || `${formatValue(data.owner)}/${String(data.name ?? "")}`;
    const fieldLabels: Record<string, string> = {
        stars: "Stars",
        forks: "Forks",
        language: "Language",
        watchers: "Watchers",
        description: "Description",
    };
    const rawValues: Record<string, unknown> = {
        stars: data.stargazerCount,
        forks: data.forkCount,
        language: formatValue(data.primaryLanguage),
        watchers: formatValue(data.watchers),
        description: data.description,
    };
    const value = rawValues[field];
    const pair: KeyValuePair = {
        label: fieldLabels[field] ?? field,
        value:
            typeof value === "number"
                ? value
                : String(value ?? ""),
    };
    const blocks: StructuredBlock[] = [
        { kind: "heading", level: 3, text: label },
        { kind: "keyValue", pairs: [pair] },
        { kind: "text", text: summary, format: "markdown" },
    ];
    return {
        historyText: summary,
        entities: [],
        displayContent: createStructuredContent(blocks, {
            rawData: { repo: label, field, value },
        }),
    };
}

// Format gh status output — parse the │-table into clean markdown sections
// code-complexity-allow: sequential gh status table parser; many format branches
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

// Build a single-issue structured view (issueView action). Renders a heading,
// a keyValue metadata block, and an optional truncated body text block, plus a
// rawData payload carrying the full gh JSON.
//
// Exported for unit tests.
export function buildStructuredIssueView(
    data: Record<string, unknown>,
): ActionResultSuccess {
    const author = data.author ? formatValue(data.author) : "unknown";
    const labels = Array.isArray(data.labels)
        ? (data.labels as Record<string, unknown>[])
              .map((l) => String(l.name ?? ""))
              .filter(Boolean)
              .join(", ")
        : "";
    const assignees = Array.isArray(data.assignees)
        ? (data.assignees as Record<string, unknown>[])
              .map((a) => formatValue(a))
              .join(", ")
        : "";
    const commentCount = Array.isArray(data.comments)
        ? data.comments.length
        : (data.comments ?? 0);

    const pairs: KeyValuePair[] = [];
    pairs.push({
        label: "State",
        value: {
            text: String(data.state ?? ""),
            badge: issueBadge(String(data.state ?? "")),
        },
    });
    pairs.push({ label: "Author", value: author });
    if (labels) pairs.push({ label: "Labels", value: labels });
    if (assignees) pairs.push({ label: "Assignees", value: assignees });
    pairs.push({ label: "Comments", value: Number(commentCount) });
    if (data.createdAt)
        pairs.push({ label: "Created", value: String(data.createdAt).slice(0, 10) });
    if (data.closedAt)
        pairs.push({ label: "Closed", value: String(data.closedAt).slice(0, 10) });
    if (data.url)
        pairs.push({ label: "Link", value: { text: String(data.url), href: String(data.url) } });

    const headingText = `#${data.number} ${data.title}`;
    const blocks: StructuredBlock[] = [
        { kind: "heading", level: 3, text: headingText },
        { kind: "keyValue", pairs },
    ];
    const body = data.body ? String(data.body) : "";
    if (body) {
        blocks.push({ kind: "divider" });
        blocks.push({
            kind: "text",
            text:
                body.slice(0, 1000) +
                (body.length > 1000 ? "\n\n*…truncated*" : ""),
            format: "markdown",
        });
    }
    return {
        historyText: headingText,
        entities: [],
        displayContent: createStructuredContent(blocks, { rawData: data }),
    };
}

// Build a single-PR structured view (prView action). Renders a heading, a
// keyValue metadata block, and an optional truncated body text block, plus a
// rawData payload carrying the full gh JSON.
//
// Exported for unit tests.
export function buildStructuredPrView(
    data: Record<string, unknown>,
): ActionResultSuccess {
    const author = data.author ? formatValue(data.author) : "unknown";
    const labels = Array.isArray(data.labels)
        ? (data.labels as Record<string, unknown>[])
              .map((l) => String(l.name ?? ""))
              .filter(Boolean)
              .join(", ")
        : "";
    const isDraft = Boolean(data.isDraft);
    const statusLabel = isDraft ? "Draft" : String(data.state ?? "");
    const statusTone: BadgeTone = isDraft
        ? "warning"
        : prBadge(data as Record<string, unknown>);

    const pairs: KeyValuePair[] = [];
    pairs.push({ label: "State", value: { text: statusLabel, badge: statusTone } });
    pairs.push({ label: "Author", value: author });
    if (data.headRefName)
        pairs.push({
            label: "Branch",
            value: `${String(data.headRefName)} → ${String(data.baseRefName ?? "")}`,
        });
    if (labels) pairs.push({ label: "Labels", value: labels });
    if (data.additions !== undefined)
        pairs.push({
            label: "Changes",
            value: `+${data.additions} −${data.deletions} across ${data.changedFiles} files`,
        });
    if (data.createdAt)
        pairs.push({ label: "Created", value: String(data.createdAt).slice(0, 10) });
    if (data.url)
        pairs.push({ label: "Link", value: { text: String(data.url), href: String(data.url) } });

    const headingText = `#${data.number} ${data.title}`;
    const blocks: StructuredBlock[] = [
        { kind: "heading", level: 3, text: headingText },
        { kind: "keyValue", pairs },
    ];
    const body = data.body ? String(data.body) : "";
    if (body) {
        blocks.push({ kind: "divider" });
        blocks.push({
            kind: "text",
            text:
                body.slice(0, 1000) +
                (body.length > 1000 ? "\n\n*…truncated*" : ""),
            format: "markdown",
        });
    }
    return {
        historyText: headingText,
        entities: [],
        displayContent: createStructuredContent(blocks, { rawData: data }),
    };
}

// ============================================================================
// Phase 5 — structured-content list results (replaces formatListResults)
// ============================================================================

// Map a PR record to a badge tone for the state column.
function prBadge(pr: Record<string, unknown>): BadgeTone {
    if (pr.isDraft) return "warning";
    const s = String(pr.state ?? "").toUpperCase();
    if (s === "OPEN") return "info";
    if (s === "MERGED") return "success";
    return "neutral";
}

// Map an issue state string to a badge tone.
function issueBadge(state: string): BadgeTone {
    const s = state.toUpperCase();
    if (s === "OPEN") return "info";
    return "neutral";
}

// Map a Dependabot severity string to a badge tone.
function severityBadge(sev: string): BadgeTone {
    switch (sev.toUpperCase()) {
        case "CRITICAL":
        case "HIGH":
            return "error";
        case "MEDIUM":
            return "warning";
        default:
            return "neutral";
    }
}

// Build a TableBlock from ColumnSpec + records, then wrap it with a heading
// in a properly-derived StructuredContent (alternates computed from all blocks).
function makeStructuredTable<T>(
    objects: T[],
    colSpecs: ColumnSpec<T>[],
    headingText: string,
    tableOptions?: {
        sortable?: boolean;
        filterable?: boolean;
        readonly?: boolean;
        pageSize?: number;
    },
): ActionResultSuccess {
    const columns = colSpecs.map(({ value: _v, ...col }) => col);
    const rows: TableCell[][] = objects.map((obj) =>
        colSpecs.map((col) => col.value(obj)),
    );
    // Cap long lists to a first page (client reveals the rest via "Show
    // more") unless the caller overrode it. All rows still ship.
    const table: TableBlock = createTable(columns, rows, {
        pageSize: 15,
        ...tableOptions,
    });
    const blocks: StructuredBlock[] = [
        { kind: "heading", level: 3, text: headingText },
        table,
    ];
    return {
        historyText: headingText,
        entities: [],
        displayContent: createStructuredContent(blocks, { rawData: objects }),
    };
}

// Build a heading + table StructuredContent for a list action. Returns
// undefined for action names that have no structured template.
//
// Exported for unit tests.
export function buildStructuredListResult(
    items: Record<string, unknown>[],
    actionName: string,
    label: string,
): ActionResultSuccess | undefined {
    const count = items.length;
    const headingText = `${label} — ${count} result${count === 1 ? "" : "s"}`;

    if (count === 0) {
        return {
            historyText: headingText,
            entities: [],
            displayContent: createStructuredContent(
                [
                    { kind: "heading", level: 3, text: headingText },
                    { kind: "text", text: "No results found." },
                ],
            ),
        };
    }

    // Pull requests
    if (actionName === "prList" && "number" in items[0]) {
        type PrRecord = {
            number: unknown;
            title: unknown;
            state: unknown;
            isDraft: unknown;
            headRefName: unknown;
            url: unknown;
            createdAt: unknown;
        };
        const cols: ColumnSpec<PrRecord>[] = [
            {
                id: "number",
                header: "#",
                type: "link",
                align: "right",
                value: (pr) => ({
                    text: String(pr.number ?? ""),
                    href: String(pr.url ?? ""),
                }),
            },
            {
                id: "title",
                header: "Title",
                value: (pr) => String(pr.title ?? ""),
            },
            {
                id: "state",
                header: "State",
                type: "badge",
                value: (pr): TableCell => {
                    const tone = prBadge(pr as Record<string, unknown>);
                    const lbl = pr.isDraft
                        ? "Draft"
                        : String(pr.state ?? "").charAt(0).toUpperCase() +
                          String(pr.state ?? "").slice(1).toLowerCase();
                    return { text: lbl, badge: tone };
                },
            },
            {
                id: "branch",
                header: "Branch",
                type: "code",
                value: (pr) => String(pr.headRefName ?? ""),
            },
            {
                id: "created",
                header: "Created",
                type: "date",
                value: (pr) => {
                    const d = pr.createdAt
                        ? new Date(String(pr.createdAt))
                        : null;
                    return d ? d.toLocaleDateString() : "";
                },
            },
        ];
        return makeStructuredTable(
            items as unknown as PrRecord[],
            cols,
            headingText,
            { sortable: true },
        );
    }

    // Issues
    if (actionName === "issueList" && "number" in items[0]) {
        type IssueRecord = {
            number: unknown;
            title: unknown;
            state: unknown;
            url: unknown;
            createdAt: unknown;
            labels: unknown;
        };
        const cols: ColumnSpec<IssueRecord>[] = [
            {
                id: "number",
                header: "#",
                type: "link",
                align: "right",
                value: (i) => ({
                    text: String(i.number ?? ""),
                    href: String(i.url ?? ""),
                }),
            },
            {
                id: "title",
                header: "Title",
                value: (i) => String(i.title ?? ""),
            },
            {
                id: "state",
                header: "State",
                type: "badge",
                value: (i): TableCell => ({
                    text:
                        String(i.state ?? "").charAt(0).toUpperCase() +
                        String(i.state ?? "").slice(1).toLowerCase(),
                    badge: issueBadge(String(i.state ?? "")),
                }),
            },
            {
                id: "labels",
                header: "Labels",
                value: (i) =>
                    Array.isArray(i.labels)
                        ? (i.labels as Record<string, unknown>[])
                              .map((l) => String(l.name ?? ""))
                              .filter(Boolean)
                              .join(", ")
                        : "",
            },
            {
                id: "created",
                header: "Created",
                type: "date",
                value: (i) => {
                    const d = i.createdAt
                        ? new Date(String(i.createdAt))
                        : null;
                    return d ? d.toLocaleDateString() : "";
                },
            },
        ];
        return makeStructuredTable(
            items as unknown as IssueRecord[],
            cols,
            headingText,
            { sortable: true },
        );
    }

    // Issues assigned to the current user (gh search issues --assignee @me)
    if (actionName === "myAssignedIssues" && "number" in items[0]) {
        type AssignedIssue = {
            number: unknown;
            title: unknown;
            url: unknown;
            repository: unknown;
            state: unknown;
            updatedAt: unknown;
            labels: unknown;
        };
        const cols: ColumnSpec<AssignedIssue>[] = [
            {
                id: "repo",
                header: "Repo",
                value: (i) => {
                    const repo = i.repository as
                        | Record<string, unknown>
                        | undefined;
                    return (
                        (repo?.nameWithOwner as string | undefined) ??
                        (repo?.name as string | undefined) ??
                        ""
                    );
                },
            },
            {
                id: "number",
                header: "#",
                type: "link",
                align: "right",
                value: (i) => ({
                    text: String(i.number ?? ""),
                    href: String(i.url ?? ""),
                }),
            },
            {
                id: "title",
                header: "Title",
                value: (i) => String(i.title ?? ""),
            },
            {
                id: "labels",
                header: "Labels",
                value: (i) =>
                    Array.isArray(i.labels)
                        ? (i.labels as Record<string, unknown>[])
                              .map((l) => String(l.name ?? ""))
                              .filter(Boolean)
                              .join(", ")
                        : "",
            },
            {
                id: "updated",
                header: "Updated",
                type: "date",
                value: (i) => {
                    const d = i.updatedAt
                        ? new Date(String(i.updatedAt))
                        : null;
                    return d ? d.toLocaleDateString() : "";
                },
            },
        ];
        return makeStructuredTable(
            items as unknown as AssignedIssue[],
            cols,
            headingText,
            { sortable: true },
        );
    }

    // Search repos
    if (actionName === "searchRepos" && "fullName" in items[0]) {
        type RepoRecord = {
            fullName: unknown;
            description: unknown;
            stargazersCount: unknown;
            url: unknown;
            updatedAt: unknown;
        };
        const cols: ColumnSpec<RepoRecord>[] = [
            {
                id: "name",
                header: "Repository",
                type: "link",
                value: (r) => ({
                    text: String(r.fullName ?? ""),
                    href: String(r.url ?? ""),
                }),
            },
            {
                id: "stars",
                header: "Stars",
                type: "number",
                align: "right",
                value: (r) => String(r.stargazersCount ?? 0),
            },
            {
                id: "description",
                header: "Description",
                value: (r) => String(r.description ?? ""),
            },
            {
                id: "updated",
                header: "Updated",
                type: "date",
                value: (r) => {
                    const d = r.updatedAt
                        ? new Date(String(r.updatedAt))
                        : null;
                    return d ? d.toLocaleDateString() : "";
                },
            },
        ];
        return makeStructuredTable(
            items as unknown as RepoRecord[],
            cols,
            headingText,
            { sortable: true },
        );
    }

    return undefined;
}

// Build a structured result for `gh repo view` (repoView action).
//
// Exported for unit tests.
export function buildStructuredRepoView(
    data: Record<string, unknown>,
    label: string,
): ActionResultSuccess {
    const pairs: KeyValuePair[] = [];
    const push = (lbl: string, val: TableCell) => {
        const text =
            typeof val === "string"
                ? val
                : typeof val === "number"
                  ? String(val)
                  : val.text;
        if (text) pairs.push({ label: lbl, value: val });
    };

    const repoName = data.owner
        ? `${formatValue(data.owner)}/${String(data.name ?? "")}`
        : String(data.name ?? "");
    push("Repository", { text: repoName, href: String(data.url ?? "") });
    if (data.description) push("Description", String(data.description));
    push("Visibility", String(data.visibility ?? ""));
    if (data.primaryLanguage)
        push("Language", formatValue(data.primaryLanguage));
    push("Stars", String(data.stargazerCount ?? 0));
    push("Forks", String(data.forkCount ?? 0));
    if (data.watchers) push("Watchers", formatValue(data.watchers));
    if (data.defaultBranchRef)
        push("Default branch", formatValue(data.defaultBranchRef));
    if (data.createdAt) {
        const d = new Date(String(data.createdAt));
        push("Created", d.toLocaleDateString());
    }
    if (data.updatedAt) {
        const d = new Date(String(data.updatedAt));
        push("Updated", d.toLocaleDateString());
    }

    const blocks: StructuredBlock[] = [
        { kind: "heading", level: 3, text: label },
        { kind: "keyValue", pairs },
    ];
    return {
        historyText: label,
        entities: [],
        displayContent: createStructuredContent(blocks, { rawData: data }),
    };
}

// Build a structured result for Dependabot alerts (security_advisory shape).
//
// Exported for unit tests.
export function buildStructuredDependabotResult(
    arr: Record<string, unknown>[],
): ActionResultSuccess {
    const headerText = `🔒 ${arr.length} Dependabot alert${arr.length === 1 ? "" : "s"}`;
    type AlertRecord = Record<string, unknown>;
    const cols: ColumnSpec<AlertRecord>[] = [
        {
            id: "severity",
            header: "Severity",
            type: "badge",
            value: (a): TableCell => {
                const adv = a.security_advisory as
                    | Record<string, unknown>
                    | undefined;
                const sev = String(adv?.severity ?? "unknown").toUpperCase();
                return { text: sev, badge: severityBadge(sev) };
            },
        },
        {
            id: "package",
            header: "Package",
            type: "code",
            value: (a): TableCell => {
                const dep = a.dependency as
                    | Record<string, unknown>
                    | undefined;
                const pkg = dep?.package as
                    | Record<string, unknown>
                    | undefined;
                return String(pkg?.name ?? "unknown");
            },
        },
        {
            id: "advisory",
            header: "Advisory",
            type: "link",
            value: (a): TableCell => {
                const adv = a.security_advisory as
                    | Record<string, unknown>
                    | undefined;
                return {
                    text: String(adv?.summary ?? ""),
                    href: String(a.html_url ?? ""),
                };
            },
        },
    ];
    return makeStructuredTable(arr, cols, headerText, { sortable: true });
}

// Build a structured result for contributor lists (login + contributions shape).
//
// Exported for unit tests.
export function buildStructuredContributorsResult(
    arr: Record<string, unknown>[],
): ActionResultSuccess {
    const headerText =
        arr.length === 1 ? "Top contributor" : `Top ${arr.length} contributors`;
    const columns = [
        { id: "rank", header: "#", type: "number" as const, align: "right" as const },
        { id: "login", header: "Contributor", type: "link" as const },
        {
            id: "contributions",
            header: "Contributions",
            type: "number" as const,
            align: "right" as const,
        },
    ];
    const rows: TableCell[][] = arr.map((u, i) => [
        String(i + 1),
        {
            text: String(u.login ?? ""),
            href: `https://github.com/${String(u.login ?? "")}`,
        },
        String(u.contributions ?? "0"),
    ]);
    const table: TableBlock = createTable(columns, rows, { sortable: true });
    const blocks: StructuredBlock[] = [
        { kind: "heading", level: 3, text: headerText },
        table,
    ];
    return {
        historyText: headerText,
        entities: [],
        displayContent: createStructuredContent(blocks, { rawData: arr }),
    };
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
        case "issueDelete":
            return `🗑️ Deleted issue **#${p.number}**.`;
        case "issueAddLabel":
            return `🏷️ Added label **${p.label}** to issue **#${p.number}**.`;
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

// ============================================================================
// Repo argument validation + clarification
//
// `gh --repo` requires `[HOST/]OWNER/REPO`. The LLM sometimes produces a bare
// name ("typeagent") because the user phrased the request that way. Rather
// than letting `gh` reject with a format error the user has to translate,
// we catch the malformed value here, search GitHub for likely matches, and
// surface a multi-choice card so the user picks the actual repo. The choice
// callback re-invokes executeAction with the corrected parameters.
//
// Sentinel string for the cancel option in the multi-choice card. Matched
// by index against the candidates list (anything past the candidate range
// is treated as cancel) — this string is only the user-facing label.
const REPO_CHOICE_CANCEL = "(none of these — cancel)";

type RepoValidationResult =
    | { kind: "ok"; action: TypeAgentAction<GithubCliActions> }
    | { kind: "clarify"; result: ActionResult };

// Searches GitHub for repos matching a bare name. Returns up to 5 OWNER/REPO
// strings. Best-effort: any failure (auth, rate limit, network) returns an
// empty list and the caller surfaces a manual-format-the-repo error instead
// of pretending the search worked.
async function searchRepoCandidates(query: string): Promise<string[]> {
    try {
        // Using `name,owner` instead of `fullName` so the field schema is
        // robust to gh CLI version drift (`fullName` is documented but the
        // owner+name pair is rock-solid across all gh versions).
        const stdout = await runGh([
            "search",
            "repos",
            query,
            "--limit",
            "5",
            "--json",
            "name,owner",
        ]);
        const data = JSON.parse(stdout) as Array<{
            name?: string;
            owner?: { login?: string };
        }>;
        return data
            .map((d) =>
                d.owner?.login && d.name ? `${d.owner.login}/${d.name}` : null,
            )
            .filter((s): s is string => s !== null);
    } catch {
        return [];
    }
}

// If the action has a `repo` parameter that's clearly malformed (a bare
// name with no `/`), build a multi-choice card asking the user to pick the
// real OWNER/REPO from search results. Otherwise return the action
// unchanged. Exported for unit tests.
export async function validateAndResolveRepo(
    action: TypeAgentAction<GithubCliActions>,
    context: ActionContext<GithubCliActionContext>,
    searchImpl: (query: string) => Promise<string[]> = searchRepoCandidates,
): Promise<RepoValidationResult> {
    const p = action.parameters as Record<string, unknown>;
    const repo = p.repo;
    // Undefined / empty / non-string → gh will use the cwd's git remote
    // (or fail later in a way the user can interpret) — not our problem.
    if (typeof repo !== "string" || repo.length === 0) {
        return { kind: "ok", action };
    }
    // OWNER/REPO, HOST/OWNER/REPO, full URL — all contain at least one `/`.
    // GitHub usernames/repo names disallow `/`, so a bare word is always
    // wrong. (`OWNER/REPO/ROUTE` would also pass this check and gh might
    // still reject it, but that's a different — and rare — failure mode
    // we leave to gh's own error.)
    if (repo.includes("/")) {
        return { kind: "ok", action };
    }

    const candidates = await searchImpl(repo);
    if (candidates.length === 0) {
        return {
            kind: "clarify",
            result: createActionResultFromError(
                `"${repo}" isn't in OWNER/REPO format and \`gh search repos\` returned no matches. Re-run with the full owner/repo (e.g. "microsoft/${repo}").`,
            ),
        };
    }

    const ctx = context.sessionContext.agentContext;
    const choices = [...candidates, REPO_CHOICE_CANCEL];
    const message = `"${repo}" isn't in OWNER/REPO format. Pick the repo you meant:`;
    return {
        kind: "clarify",
        result: createMultiChoiceResult(
            ctx.choiceManager,
            message,
            choices,
            async (selectedIndices, liveContext) => {
                if (selectedIndices.length === 0) return undefined;
                // Single-pick semantics on a multi-choice surface: take
                // the first index. Indices past candidates.length-1 are
                // the cancel sentinel.
                const idx = selectedIndices[0];
                if (idx >= candidates.length) {
                    // Replace the bubble text — leaving the "isn't in
                    // OWNER/REPO format. Pick the repo you meant:" prompt
                    // above a "Cancelled" notice would read stale.
                    liveContext.actionIO.setDisplay({
                        type: "text",
                        content: `Cancelled. Re-run the command with the full owner/repo (e.g. "microsoft/${repo}").`,
                        kind: "error",
                    });
                    return undefined;
                }
                const picked = candidates[idx];
                const correctedAction = {
                    ...action,
                    parameters: { ...action.parameters, repo: picked },
                } as TypeAgentAction<GithubCliActions>;
                const result = await executeAction(
                    correctedAction,
                    liveContext as ActionContext<GithubCliActionContext>,
                );
                // Replace the bubble content with the action's result.
                // We bypass the dispatcher's default appendDisplay-after-
                // handleChoice path by writing via setDisplay here and
                // returning undefined — otherwise the choice card prompt
                // ("isn't in OWNER/REPO format. Pick the repo you meant:")
                // would still sit above the result.
                if (result.error !== undefined) {
                    liveContext.actionIO.setDisplay({
                        type: "text",
                        content: result.error,
                        kind: "error",
                    });
                } else if (result.displayContent !== undefined) {
                    liveContext.actionIO.setDisplay(result.displayContent);
                }
                return undefined;
            },
        ),
    };
}

// code-complexity-allow: top-level action dispatch over all github-cli actions
async function executeAction(
    action: TypeAgentAction<GithubCliActions>,
    context: ActionContext<unknown>,
): Promise<ActionResult> {
    // Bare-name repo guard — see validateAndResolveRepo. Runs before
    // buildArgs so we never hand `gh` a malformed --repo value.
    const validated = await validateAndResolveRepo(
        action,
        context as ActionContext<GithubCliActionContext>,
    );
    if (validated.kind === "clarify") {
        return validated.result;
    }
    action = validated.action;

    const args = buildArgs(action);
    if (!args) {
        return createActionResultFromTextDisplay(
            `Unknown action: ${action.actionName}`,
        );
    }

    const p = action.parameters as Record<string, unknown>;

    try {
        const output = await runGh(args);

        // Mutations that print a URL like https://github.com/owner/repo/issues/123
        // — emit an entity so follow-ups ("that issue", "delete it") can resolve.
        if (
            output &&
            (action.actionName === "issueCreate" ||
                action.actionName === "prCreate")
        ) {
            const m = output.match(
                /https:\/\/github\.com\/([^/\s]+\/[^/\s]+)\/(?:issues|pull)\/(\d+)/,
            );
            if (m) {
                const repo = m[1];
                const number = parseInt(m[2], 10);
                const url = m[0];
                const isIssue = action.actionName === "issueCreate";
                const title = String(p.title ?? "");
                const kindLabel = isIssue ? "issue" : "PR";
                const entity = {
                    name: `#${number}`,
                    type: [isIssue ? "issue" : "pullRequest", "github"],
                    uniqueId: url,
                    facets: [
                        { name: "number", value: number },
                        { name: "repo", value: repo },
                        { name: "url", value: url },
                        ...(title ? [{ name: "title", value: title }] : []),
                    ],
                };
                const md =
                    `✅ Created ${kindLabel} **#${number}** in **${repo}**` +
                    (title ? `: ${title}` : "") +
                    `\n\n${url}`;
                return createActionResultFromMarkdownDisplay(
                    md,
                    undefined,
                    [entity],
                    entity,
                );
            }
        }

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
                    const result = buildStructuredField(
                        String(p.field),
                        data,
                        String(p.repo ?? data.name ?? ""),
                    );
                    if (result) {
                        return result;
                    }
                }

                // Array results: issues, PRs, search repos
                if (Array.isArray(data)) {
                    const result = buildStructuredListResult(
                        data as Record<string, unknown>[],
                        action.actionName,
                        cmdLabel,
                    );
                    if (result) {
                        return result;
                    }
                }

                // Single issue view — rich formatted output
                if (action.actionName === "issueView" && "number" in data) {
                    return buildStructuredIssueView(data);
                }

                // Single PR view — rich formatted output
                if (action.actionName === "prView" && "number" in data) {
                    return buildStructuredPrView(data);
                }

                // Repo view — structured key-value block
                if (action.actionName === "repoView") {
                    return buildStructuredRepoView(data, cmdLabel);
                }

                // Single object fallback
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
                    return buildStructuredDependabotResult(arr);
                }

                // Contributors
                if (arr.length > 0 && "login" in arr[0]) {
                    return buildStructuredContributorsResult(arr);
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
