// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type OnboardingActions =
    | StartOnboardingAction
    | ResumeOnboardingAction
    | GetOnboardingStatusAction
    | ListIntegrationsAction;

export type StartOnboardingAction = {
    actionName: "startOnboarding";
    parameters: {
        // Unique name for this integration (e.g. "slack", "jira", "my-rest-api").
        // Used as the workspace folder name — lowercase, no spaces.
        integrationName: string;
        // Human-readable description of what the integration does
        description?: string;
        // The type of API being integrated; helps select appropriate templates and bridge patterns
        apiType?: "rest" | "graphql" | "websocket" | "ipc" | "sdk";
    };
};

export type ResumeOnboardingAction = {
    actionName: "resumeOnboarding";
    parameters: {
        // Name of the integration to resume
        integrationName: string;
        // Optional: override which phase to start from (defaults to current phase in state.json)
        fromPhase?:
            | "discovery"
            | "phraseGen"
            | "schemaGen"
            | "grammarGen"
            | "scaffolder"
            | "testing"
            | "packaging";
    };
};

export type GetOnboardingStatusAction = {
    actionName: "getOnboardingStatus";
    parameters: {
        // Integration name to check status for
        integrationName: string;
    };
};

export type ListIntegrationsAction = {
    actionName: "listIntegrations";
    parameters: {
        // Filter by phase status; omit to list all
        status?: "in-progress" | "complete";
    };
};
