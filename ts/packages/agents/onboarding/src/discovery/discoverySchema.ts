// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DiscoveryActions =
    | CrawlDocUrlAction
    | ParseOpenApiSpecAction
    | ListDiscoveredActionsAction
    | ApproveApiSurfaceAction;

export type CrawlDocUrlAction = {
    actionName: "crawlDocUrl";
    parameters: {
        // Name of the integration being onboarded
        integrationName: string;
        // URL of the API documentation page to crawl (e.g. "https://api.slack.com/methods")
        url: string;
        // Maximum link-follow depth (default: 2)
        maxDepth?: number;
    };
};

export type ParseOpenApiSpecAction = {
    actionName: "parseOpenApiSpec";
    parameters: {
        // Name of the integration being onboarded
        integrationName: string;
        // URL or absolute file path to the OpenAPI 3.x or Swagger 2.x spec
        specSource: string;
    };
};

export type ListDiscoveredActionsAction = {
    actionName: "listDiscoveredActions";
    parameters: {
        // Integration name to list discovered actions for
        integrationName: string;
    };
};

export type ApproveApiSurfaceAction = {
    actionName: "approveApiSurface";
    parameters: {
        // Integration name to approve
        integrationName: string;
        // If provided, only these action names are included in the approved surface (excludes all others)
        includeActions?: string[];
        // Action names to exclude from the approved surface
        excludeActions?: string[];
    };
};
