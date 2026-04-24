// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Union type combining all PowerShell namespace actions
// Used for type-safe action dispatch in the action handler

import type { PowerShellActions } from "./scriptActions.mjs";
import type { PowerShellFilesActions } from "../namespaces/files/filesActionsSchema.js";
import type { PowerShellProcessesActions } from "../namespaces/processes/processesActionsSchema.js";
import type { PowerShellSystemActions } from "../namespaces/system/systemActionsSchema.js";
import type { PowerShellServicesActions } from "../namespaces/services/servicesActionsSchema.js";
import type { PowerShellNetworkActions } from "../namespaces/network/networkActionsSchema.js";
import type { PowerShellDataActions } from "../namespaces/data/dataActionsSchema.js";
import type { PowerShellArchivesActions } from "../namespaces/archives/archivesActionsSchema.js";

export type AllPowerShellActions =
    | PowerShellActions
    | PowerShellFilesActions
    | PowerShellProcessesActions
    | PowerShellSystemActions
    | PowerShellServicesActions
    | PowerShellNetworkActions
    | PowerShellDataActions
    | PowerShellArchivesActions;
