// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionSchemaFile } from "@typeagent/action-schema";
import { ActionConfig } from "./actionConfig.js";

export interface ActionConfigProvider {
    tryGetActionConfig(schemaName: string): ActionConfig | undefined;
    getActionConfig(schemaName: string): ActionConfig;
    getActionConfigs(): [string, ActionConfig][];
    getActionSchemaFileForConfig(config: ActionConfig): ActionSchemaFile;
}
