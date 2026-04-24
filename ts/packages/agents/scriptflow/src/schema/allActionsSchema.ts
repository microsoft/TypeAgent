// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Union type combining all ScriptFlow namespace actions
// Used for type-safe action dispatch in the action handler

import type { ScriptFlowActions } from "./scriptActions.mjs";
import type { ScriptFlowFilesActions } from "../namespaces/files/filesActionsSchema.js";
import type { ScriptFlowProcessesActions } from "../namespaces/processes/processesActionsSchema.js";
import type { ScriptFlowSystemActions } from "../namespaces/system/systemActionsSchema.js";
import type { ScriptFlowServicesActions } from "../namespaces/services/servicesActionsSchema.js";
import type { ScriptFlowNetworkActions } from "../namespaces/network/networkActionsSchema.js";
import type { ScriptFlowDataActions } from "../namespaces/data/dataActionsSchema.js";
import type { ScriptFlowArchivesActions } from "../namespaces/archives/archivesActionsSchema.js";

export type AllScriptFlowActions =
    | ScriptFlowActions
    | ScriptFlowFilesActions
    | ScriptFlowProcessesActions
    | ScriptFlowSystemActions
    | ScriptFlowServicesActions
    | ScriptFlowNetworkActions
    | ScriptFlowDataActions
    | ScriptFlowArchivesActions;
