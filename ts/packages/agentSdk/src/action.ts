// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DisplayContent } from "./display.js";
import { Entity } from "./memory.js";

export interface AppAction {
    actionName: string;
    translatorName?: string;
    parameters?: Record<string, unknown> | undefined; // the type of the parameters are defined by the AppAgent
}

export type ActionResultError = {
    error: string;
};

export type ActionResultSuccessNoDisplay = {
    literalText?: string | undefined;
    displayContent?: undefined;
    entities: Entity[];
    resultEntity?: Entity | undefined;
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    additionalInstructions?: string[] | undefined;
    error?: undefined;
};

export type ActionResultSuccess = {
    literalText?: string | undefined;
    displayContent: DisplayContent;
    entities: Entity[];
    resultEntity?: Entity | undefined;
    dynamicDisplayId?: string | undefined;
    dynamicDisplayNextRefreshMs?: number | undefined;
    additionalInstructions?: string[] | undefined;
    error?: undefined;
};

export type ActionResult =
    | ActionResultSuccessNoDisplay
    | ActionResultSuccess
    | ActionResultError;

type EntityField<T> = T extends string
    ? Entity
    : T extends any[]
      ? (EntityField<Required<T[number]>> | undefined)[]
      : T extends object
        ? EntityField<T>
        : undefined;

export type EntityMap<T> = {
    [Property in keyof T]?: EntityField<T[Property]>;
};

export type ActionEntities<T extends AppAction = AppAction> =
    T["parameters"] extends undefined
        ? undefined
        : EntityMap<Required<T["parameters"]>>;

export type TypeAgentAction<
    T extends AppAction = AppAction,
    Name extends string = string,
> = T extends AppAction
    ? T & {
          translatorName: Name;
          entities?: ActionEntities<T>;
      }
    : never;
