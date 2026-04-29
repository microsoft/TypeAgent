// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Union type combining all PowerShell namespace actions
// Used for type-safe action dispatch in the action handler

import type { PowerShellActions } from "./scriptActions.mjs";
import type { PowerShellFilesActions } from "../namespaces/files/filesActionsSchema.mjs";
import type { PowerShellProcessesActions } from "../namespaces/processes/processesActionsSchema.mjs";
import type { PowerShellSystemActions } from "../namespaces/system/systemActionsSchema.mjs";
import type { PowerShellServicesActions } from "../namespaces/services/servicesActionsSchema.mjs";
import type { PowerShellNetworkActions } from "../namespaces/network/networkActionsSchema.mjs";
import type { PowerShellDataActions } from "../namespaces/data/dataActionsSchema.mjs";
import type { PowerShellArchivesActions } from "../namespaces/archives/archivesActionsSchema.mjs";

// Re-export all action types for convenience
export * from "./scriptActions.mjs";
export * from "../namespaces/files/filesActionsSchema.mjs";
export * from "../namespaces/processes/processesActionsSchema.mjs";
export * from "../namespaces/system/systemActionsSchema.mjs";
export * from "../namespaces/services/servicesActionsSchema.mjs";
export * from "../namespaces/network/networkActionsSchema.mjs";
export * from "../namespaces/data/dataActionsSchema.mjs";
export * from "../namespaces/archives/archivesActionsSchema.mjs";

export type AllPowerShellActions =
    | PowerShellActions
    | PowerShellFilesActions
    | PowerShellProcessesActions
    | PowerShellSystemActions
    | PowerShellServicesActions
    | PowerShellNetworkActions
    | PowerShellDataActions
    | PowerShellArchivesActions;
