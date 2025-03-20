// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ParsedActionSchema } from "action-schema";
import { ActionConfig } from "./actionConfig.js";

export type ActionSchemaFile = {
    // Schema name
    schemaName: string;

    // original file source hash
    sourceHash: string;

    // Parsed action schema
    parsedActionSchema: ParsedActionSchema;
};

export interface ActionConfigProvider {
    tryGetActionConfig(schemaName: string): ActionConfig | undefined;
    getActionConfig(schemaName: string): ActionConfig;
    getActionConfigs(): ActionConfig[];
    getActionSchemaFileForConfig(config: ActionConfig): ActionSchemaFile;
}
