// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export enum ProfileNames {
    // Measures
    command = "command",
    executeCommand = "executeCommand",
    request = "request",
    executeAction = "executeAction",
    translate = "translate", // request translations

    // Marks
    firstToken = "firstToken", // within translate measure
}
