// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export { createDispatcher, Dispatcher, CommandResult } from "./dispatcher.js";
export type { DispatcherOptions } from "./context/commandHandlerContext.js";
export type { CommandCompletionResult } from "./command/completion.js";
export type {
    AppAgentProvider,
    AppAgentInstaller,
    ConstructionProvider,
} from "./agentProvider/agentProvider.js";
export type {
    ClientIO,
    RequestId,
    IAgentMessage,
    NotifyExplainedData,
} from "./context/interactiveIO.js";
export type { Timing, PhaseTiming, RequestMetrics } from "./utils/metrics.js";
export type {
    TemplateEditConfig,
    TemplateData,
} from "./translation/actionTemplate.js";
export { getUserDataDir, getInstanceDir } from "./utils/userData.js";
export { getChatHistoryForTranslation } from "./translation/translateRequest.js";
