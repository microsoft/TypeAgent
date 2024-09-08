// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AppAgent, TopLevelTranslatorConfig } from "@typeagent/agent-sdk";

export interface AppAgentProvider {
    getAppAgentNames(): string[];
    getAppAgentConfig(appAgentName: string): Promise<TopLevelTranslatorConfig>;
    loadAppAgent(appAgentName: string): Promise<AppAgent>;
}
