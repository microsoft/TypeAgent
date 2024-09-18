// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayContent } from "./display.js";
import { Entity } from "./memory.js";

export interface AppAction {
    actionName: string;
    translatorName?: string | undefined;
}

export interface AppActionWithParameters extends AppAction {
    parameters: { [key: string]: any };
}

export type ActionResultError = {
    error: string;
};

export type ActionResultSuccessNoDisplay = {
    literalText?: string | undefined;
    displayContent?: undefined;
    entities: Entity[];
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    error?: undefined;
};

export type ActionResultSuccess = {
    literalText?: string | undefined;
    displayContent: DisplayContent;
    entities: Entity[];
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    error?: undefined;
};

export type ActionResult =
    | ActionResultSuccessNoDisplay
    | ActionResultSuccess
    | ActionResultError;
