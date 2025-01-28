// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ActionSchemaFile } from "action-schema";
import { ActionConfig, convertToActionConfig } from "./actionConfig.js";
import { AppAgentProvider } from "../agentProvider/agentProvider.js";
import { AppAgentManifest } from "@typeagent/agent-sdk";
import {
    ActionSchemaFileCache,
    createSchemaInfoProvider,
} from "./actionSchemaFileCache.js";

export interface ActionConfigProvider {
    tryGetActionConfig(schemaName: string): ActionConfig | undefined;
    getActionConfig(schemaName: string): ActionConfig;
    getActionConfigs(): [string, ActionConfig][];
    getActionSchemaFileForConfig(config: ActionConfig): ActionSchemaFile;
}
