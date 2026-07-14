// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type GithubCliActions =
    | AuthLoginAction
    | AuthLogoutAction
    | AuthStatusAction
    | BrowseRepoAction
    | BrowseIssueAction
    | BrowsePrAction
    | CodespaceCreateAction
    | CodespaceDeleteAction
    | CodespaceListAction
    | GistCreateAction
    | GistDeleteAction
    | GistListAction
    | IssueCreateAction
    | IssueCloseAction
    | IssueDeleteAction
    | IssueReopenAction
    | IssueListAction
    | IssueViewAction
    | OrgListAction
    | OrgViewAction
    | PrCreateAction
    | PrCloseAction
    | PrMergeAction
    | PrListAction
    | PrViewAction
    | PrCheckoutAction
    | PrChecksAction
    | ProjectCreateAction
    | ProjectDeleteAction
    | ProjectListAction
    | ReleaseCreateAction
    | ReleaseDeleteAction
    | ReleaseListAction
    | RepoCreateAction
    | RepoCloneAction
    | RepoDeleteAction
    | RepoViewAction
    | RepoForkAction
    | StarRepoAction
    | CacheListAction
    | CacheDeleteAction
    | RunViewAction
    | WorkflowViewAction
    | AgentTaskRunAction
    | AliasSetAction
    | ApiRequestAction
    | AttestationCreateAction
    | CompletionGenerateAction
    | ConfigSetAction
    | CopilotRunAction
    | ExtensionInstallAction
    | GpgKeyAddAction
    | LabelCreateAction
    | LicensesViewAction
    | PreviewExecuteAction
    | RulesetViewAction
    | SearchReposAction
    | SecretCreateAction
    | SshKeyAddAction
    | StatusPrintAction
    | MyAssignedIssuesAction
    | MyPullRequestsAction
    | IssueAddLabelAction
    | VariableCreateAction
    | DependabotAlertsAction;

export type AuthLoginAction = {
    actionName: "authLogin";
    parameters: {
        hostname?: string;

        web?: boolean;

        token?: string;
    };
};

export type AuthLogoutAction = {
    actionName: "authLogout";
    parameters: {
        hostname?: string;
    };
};

export type AuthStatusAction = {
    actionName: "authStatus";
    parameters: {
        hostname?: string;

        showToken?: boolean;
    };
};

export type BrowseRepoAction = {
    actionName: "browseRepo";
    parameters: {
        branch?: string;

        commit?: string;

        tag?: string;
    };
};

export type BrowseIssueAction = {
    actionName: "browseIssue";
    parameters: {
        number?: number;
    };
};

export type BrowsePrAction = {
    actionName: "browsePr";
    parameters: {
        number?: number;
    };
};

export type CodespaceCreateAction = {
    actionName: "codespaceCreate";
    parameters: {
        repo?: string;

        branch?: string;

        location?: string;
    };
};

export type CodespaceDeleteAction = {
    actionName: "codespaceDelete";
    parameters: {
        name?: string;
    };
};

export type CodespaceListAction = {
    actionName: "codespaceList";
    parameters: {};
};

export type GistCreateAction = {
    actionName: "gistCreate";
    parameters: {
        public?: boolean;

        description?: string;
    };
};

export type GistDeleteAction = {
    actionName: "gistDelete";
    parameters: {
        id?: string;
    };
};

export type GistListAction = {
    actionName: "gistList";
    parameters: {
        public?: boolean;
    };
};

export type IssueCreateAction = {
    actionName: "issueCreate";
    parameters: {
        // owner/repo
        repo?: string;

        title?: string;

        body?: string;

        assignee?: string;

        label?: string;
    };
};

export type IssueCloseAction = {
    actionName: "issueClose";
    parameters: {
        number?: number;
    };
};

// Permanently delete a GitHub issue (uses `gh issue delete --yes`).
export type IssueDeleteAction = {
    actionName: "issueDelete";
    parameters: {
        number: number;
        repo?: string;
    };
};

export type IssueReopenAction = {
    actionName: "issueReopen";
    parameters: {
        number?: number;
    };
};

export type IssueListAction = {
    actionName: "issueList";
    parameters: {
        repo?: string;

        state?: string;

        label?: string;

        // Filter by author (issue creator): a GitHub login (e.g. "octocat") or
        // "@me" for the current user. Use this for "issues I opened".
        author?: string;

        // Filter by assignee: a GitHub login (e.g. "octocat"), "@me" for the
        // current user, or "none" to list only unassigned issues. Use this for
        // "issues assigned to me".
        assignee?: string;

        limit?: number;
    };
};

// View / open a specific GitHub issue by number.
//
// Example:
// User: show issue 2222
// Agent: { actionName: "issueView", parameters: { number: 2222 } }
//
// Example:
// User: view issue #42 in microsoft/TypeAgent
// Agent: { actionName: "issueView", parameters: { number: 42, repo: "microsoft/TypeAgent" } }
export type IssueViewAction = {
    actionName: "issueView";
    parameters: {
        // The issue number. Omit when the user references an issue via entity
        // resolution ("that issue", "the issue we just opened") — the dispatcher
        // will substitute it.
        number?: number;

        // OWNER/REPO slug (e.g. "microsoft/TypeAgent"). Omit unless the user names the repo.
        repo?: string;
    };
};

export type OrgListAction = {
    actionName: "orgList";
    parameters: {};
};

export type OrgViewAction = {
    actionName: "orgView";
    parameters: {
        name?: string;
    };
};

export type PrCreateAction = {
    actionName: "prCreate";
    parameters: {
        title?: string;

        body?: string;

        base?: string;

        head?: string;

        draft?: boolean;
    };
};

export type PrCloseAction = {
    actionName: "prClose";
    parameters: {
        number?: number;
    };
};

export type PrMergeAction = {
    actionName: "prMerge";
    parameters: {
        number?: number;

        mergeMethod?: string;
    };
};

// List pull requests, optionally filtered by repo, state, label, author, or
// assignee.
//
// A PR is "mine" when the user *authored* it. On GitHub the owner of a PR is
// its author, not its assignee (self-assignment is rare), so "my PRs", "PRs I
// opened", and "are any of those mine?" map to author: "@me" — NOT assignee.
//
// Example:
// User: are any of those mine?  (after listing open PRs in microsoft/TypeAgent)
// Agent: { actionName: "prList", parameters: { repo: "microsoft/TypeAgent", state: "open", author: "@me" } }
//
// Example:
// User: show my open pull requests
// Agent: { actionName: "prList", parameters: { state: "open", author: "@me" } }
export type PrListAction = {
    actionName: "prList";
    parameters: {
        repo?: string;

        state?: string;

        label?: string;

        // Filter by author (PR creator): a GitHub login (e.g. "octocat") or
        // "@me" for the current user. Use this for "my PRs" / "PRs I opened".
        author?: string;

        // Filter by assignee: a GitHub login (e.g. "octocat"), "@me" for the
        // current user, or "none" to list only unassigned pull requests. Most
        // PRs have no assignee — prefer `author` for "my PRs".
        assignee?: string;

        limit?: number;
    };
};

// View / open a specific GitHub pull request by number.
//
// Example:
// User: show PR 2196
// Agent: { actionName: "prView", parameters: { number: 2196 } }
//
// Example:
// User: view pull request #42 in microsoft/TypeAgent
// Agent: { actionName: "prView", parameters: { number: 42, repo: "microsoft/TypeAgent" } }
export type PrViewAction = {
    actionName: "prView";
    parameters: {
        // The pull request number. Omit when the user references a PR via entity
        // resolution ("that PR", "the PR we just opened") — the dispatcher will
        // substitute it.
        number?: number;

        // OWNER/REPO slug (e.g. "microsoft/TypeAgent"). Omit unless the user names the repo.
        repo?: string;
    };
};

export type PrCheckoutAction = {
    actionName: "prCheckout";
    parameters: {
        number?: number;

        branch?: string;
    };
};

export type PrChecksAction = {
    actionName: "prChecks";
    parameters: {
        number: number;
        repo?: string;
    };
};

export type ProjectCreateAction = {
    actionName: "projectCreate";
    parameters: {
        name?: string;

        body?: string;
    };
};

export type ProjectDeleteAction = {
    actionName: "projectDelete";
    parameters: {
        id?: string;
    };
};

export type ProjectListAction = {
    actionName: "projectList";
    parameters: {};
};

export type ReleaseCreateAction = {
    actionName: "releaseCreate";
    parameters: {
        tag?: string;

        title?: string;

        notes?: string;
    };
};

export type ReleaseDeleteAction = {
    actionName: "releaseDelete";
    parameters: {
        id?: string;
    };
};

export type ReleaseListAction = {
    actionName: "releaseList";
    parameters: {
        repo?: string;
    };
};

export type RepoCreateAction = {
    actionName: "repoCreate";
    parameters: {
        name?: string;

        description?: string;

        public?: boolean;

        private?: boolean;
    };
};

export type RepoCloneAction = {
    actionName: "repoClone";
    parameters: {
        repo?: string;

        branch?: string;
    };
};

export type RepoDeleteAction = {
    actionName: "repoDelete";
    parameters: {
        repo?: string;
    };
};

export type CacheListAction = {
    actionName: "cacheList";
    parameters: {};
};

export type CacheDeleteAction = {
    actionName: "cacheDelete";
    parameters: {
        id?: string;
    };
};

export type RunViewAction = {
    actionName: "runView";
    parameters: {
        id?: string;
    };
};

export type WorkflowViewAction = {
    actionName: "workflowView";
    parameters: {
        id?: string;
    };
};

export type AgentTaskRunAction = {
    actionName: "agentTaskRun";
    parameters: {
        task?: string;
    };
};

export type AliasSetAction = {
    actionName: "aliasSet";
    parameters: {
        name?: string;

        command?: string;
    };
};

export type ApiRequestAction = {
    actionName: "apiRequest";
    parameters: {
        method?: string;

        endpoint?: string;

        limit?: number;
    };
};

export type AttestationCreateAction = {
    actionName: "attestationCreate";
    parameters: {
        artifact?: string;

        type?: string;
    };
};

export type CompletionGenerateAction = {
    actionName: "completionGenerate";
    parameters: {
        shell?: string;
    };
};

export type ConfigSetAction = {
    actionName: "configSet";
    parameters: {
        name?: string;

        value?: string;
    };
};

export type CopilotRunAction = {
    actionName: "copilotRun";
    parameters: {
        task?: string;
    };
};

export type ExtensionInstallAction = {
    actionName: "extensionInstall";
    parameters: {
        name?: string;
    };
};

export type GpgKeyAddAction = {
    actionName: "gpgKeyAdd";
    parameters: {
        key?: string;
    };
};

export type LabelCreateAction = {
    actionName: "labelCreate";
    parameters: {
        name?: string;

        color?: string;
    };
};

export type IssueAddLabelAction = {
    actionName: "issueAddLabel";
    parameters: {
        number: number;

        label: string;

        repo?: string;
    };
};

export type LicensesViewAction = {
    actionName: "licensesView";
    parameters: {};
};

export type PreviewExecuteAction = {
    actionName: "previewExecute";
    parameters: {
        feature?: string;
    };
};

export type RulesetViewAction = {
    actionName: "rulesetView";
    parameters: {
        repo?: string;
    };
};

export type RepoViewAction = {
    actionName: "repoView";
    parameters: {
        repo?: string;

        field?: string;
    };
};

export type RepoForkAction = {
    actionName: "repoFork";
    parameters: {
        repo?: string;

        name?: string;
    };
};

export type StarRepoAction = {
    actionName: "starRepo";
    parameters: {
        repo?: string;

        unstar?: boolean;
    };
};

export type SearchReposAction = {
    actionName: "searchRepos";
    parameters: {
        query?: string;
    };
};

export type SecretCreateAction = {
    actionName: "secretCreate";
    parameters: {
        name?: string;

        value?: string;
    };
};

export type SshKeyAddAction = {
    actionName: "sshKeyAdd";
    parameters: {
        key?: string;
    };
};

export type StatusPrintAction = {
    actionName: "statusPrint";
    parameters: {};
};

// List issues assigned to the current authenticated user across all
// repositories. Maps to `gh search issues --assignee @me --state open`.
export type MyAssignedIssuesAction = {
    actionName: "myAssignedIssues";
    parameters: {
        // Maximum number of issues to return (default 20)
        limit?: number;
    };
};

// List the current user's own pull requests across ALL repositories — the PRs
// they authored. Maps to `gh search prs --author @me`. Use this for "my PRs",
// "PRs I opened", or "my open PRs everywhere" when no specific repo is named.
// For PRs within a single repo, use `prList` with author: "@me" instead.
export type MyPullRequestsAction = {
    actionName: "myPullRequests";
    parameters: {
        // Filter by state: "open" (default) or "closed".
        state?: string;

        // Scope the search to a single org/user's repositories (e.g.
        // "microsoft"). Omit to search every repository the user can see.
        owner?: string;

        // Maximum number of pull requests to return (default 20).
        limit?: number;
    };
};

export type VariableCreateAction = {
    actionName: "variableCreate";
    parameters: {
        name?: string;

        value?: string;
    };
};

export type DependabotAlertsAction = {
    actionName: "dependabotAlerts";
    parameters: {
        // owner/repo
        repo?: string;
        // Filter by severity: critical, high, medium, low
        severity?: string;
        // Filter by state: open, dismissed, fixed
        state?: string;
    };
};
