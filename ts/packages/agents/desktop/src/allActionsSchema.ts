// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// This file provides a union of all desktop actions including main and sub-schemas
// Used by connector.ts to handle all action types

import type { DesktopActions } from "./actionsSchema.js";
import type { DesktopDisplayActions } from "./windows/displayActionsSchema.js";
import type { DesktopPersonalizationActions } from "./windows/personalizationActionsSchema.js";
import type { DesktopTaskbarActions } from "./windows/taskbarActionsSchema.js";
import type { DesktopInputActions } from "./windows/inputActionsSchema.js";
import type { DesktopPrivacyActions } from "./windows/privacyActionsSchema.js";
import type { DesktopPowerActions } from "./windows/powerActionsSchema.js";
import type { DesktopSystemActions } from "./windows/systemActionsSchema.js";

// Re-export all action types for convenience
export * from "./actionsSchema.js";
export * from "./windows/displayActionsSchema.js";
export * from "./windows/personalizationActionsSchema.js";
export * from "./windows/taskbarActionsSchema.js";
export * from "./windows/inputActionsSchema.js";
export * from "./windows/privacyActionsSchema.js";
export * from "./windows/powerActionsSchema.js";
export * from "./windows/systemActionsSchema.js";

// Union of all desktop actions (main + sub-schemas)
export type AllDesktopActions =
    | DesktopActions
    | DesktopDisplayActions
    | DesktopPersonalizationActions
    | DesktopTaskbarActions
    | DesktopInputActions
    | DesktopPrivacyActions
    | DesktopPowerActions
    | DesktopSystemActions;
