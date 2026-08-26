// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DispatcherDiagnosticsActions =
    | DispatchRequestAction
    | MatchDispatcherRequestAction
    | TranslateDispatcherRequestAction
    | ReasonAboutRequestAction
    | ExplainDispatcherRequestAction;

// user: ask the TypeAgent dispatcher to handle "play some jazz"
// agent: { "actionName": "dispatchRequest", "parameters": { "request": "play some jazz" } }
// Submit a nested request through the normal TypeAgent dispatcher pipeline.
export type DispatchRequestAction = {
    actionName: "dispatchRequest";
    parameters?: {
        // The nested request to dispatch; defaults to an empty request.
        request?: string;
    };
};

// user: show how the TypeAgent dispatcher grammar matches "play some jazz"
// agent: { "actionName": "matchDispatcherRequest", "parameters": { "request": "play some jazz" } }
// Match a request without executing its actions.
export type MatchDispatcherRequestAction = {
    actionName: "matchDispatcherRequest";
    parameters: {
        // The request to match.
        request: string;
    };
};

// user: translate "play some jazz" with TypeAgent dispatcher history
// agent: { "actionName": "translateDispatcherRequest", "parameters": { "request": "play some jazz", "useHistory": true } }
// Translate a request into actions without executing them.
export type TranslateDispatcherRequestAction = {
    actionName: "translateDispatcherRequest";
    parameters: {
        // The request to translate.
        request: string;
        // Whether translation should include conversation history; defaults to false.
        useHistory?: boolean;
    };
};

// user: use the Copilot reasoning engine on "plan my afternoon"
// agent: { "actionName": "reasonAboutRequest", "parameters": { "request": "plan my afternoon", "engine": "copilot" } }
// Run a request through a selected TypeAgent reasoning engine.
export type ReasonAboutRequestAction = {
    actionName: "reasonAboutRequest";
    parameters: {
        // The request to reason about.
        request: string;
        // Reasoning engine override; defaults to the configured engine.
        engine?: "claude" | "copilot" | "none";
    };
};

// user: explain the TypeAgent translation "play jazz => player.playMusic"
// agent: { "actionName": "explainDispatcherRequest", "parameters": { "requestAction": "play jazz => player.playMusic" } }
// Explain a serialized TypeAgent request/action translation.
export type ExplainDispatcherRequestAction = {
    actionName: "explainDispatcherRequest";
    parameters: {
        // The serialized request/action translation to explain.
        requestAction: string;
        // Number of explanation runs; defaults to 1.
        repeat?: number;
        // Whether to filter values copied from the request; defaults to false.
        filterValueInRequest?: boolean;
        // Whether to filter reference words; defaults to false.
        filterReference?: boolean;
        // Maximum concurrent explanation runs; defaults to 5.
        concurrency?: number;
    };
};
