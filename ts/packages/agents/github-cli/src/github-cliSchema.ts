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

        assignee?: string;

        limit?: number;
    };
};

export type IssueViewAction = {
    actionName: "issueView";
    parameters: {
        number?: number;

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

export type PrListAction = {
    actionName: "prList";
    parameters: {
        repo?: string;

        state?: string;

        label?: string;

        assignee?: string;

        limit?: number;
    };
};

export type PrViewAction = {
    actionName: "prView";
    parameters: {
        number?: number;

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
