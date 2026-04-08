// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PackagingActions =
    | PackageAgentAction
    | ValidatePackageAction
    | GenerateDemoAction
    | GenerateReadmeAction;

export type PackageAgentAction = {
    actionName: "packageAgent";
    parameters: {
        // Integration name to package
        integrationName: string;
        // If true, also register the agent with the local TypeAgent dispatcher config
        register?: boolean;
    };
};

export type ValidatePackageAction = {
    actionName: "validatePackage";
    parameters: {
        // Integration name whose package to validate
        integrationName: string;
    };
};

// Generates a README.md for the onboarded agent
export type GenerateReadmeAction = {
    actionName: "generateReadme";
    parameters: {
        // Name of the integration
        integrationName: string;
    };
};

// Generates a demo script and narration for the onboarded agent
export type GenerateDemoAction = {
    actionName: "generateDemo";
    parameters: {
        // Name of the integration
        integrationName: string;
        // Duration target in minutes (default: 3-5)
        durationMinutes?: string;
    };
};
