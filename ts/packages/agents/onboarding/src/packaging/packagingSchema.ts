// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type PackagingActions =
    | PackageAgentAction
    | ValidatePackageAction;

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
