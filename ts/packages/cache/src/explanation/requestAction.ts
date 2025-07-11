// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection } from "typechat";
import {
    AppAction,
    TypeAgentAction,
    Entity,
    ActivityContext,
} from "@typeagent/agent-sdk";

export type PromptEntity = Entity & {
    sourceAppAgentName: string;
};

export type HistoryContext = {
    promptSections: PromptSection[];
    entities: PromptEntity[];
    additionalInstructions?: string[] | undefined;
    activityContext?: ActivityContext | undefined;
};

export function normalizeParamString(str: string) {
    return str
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase();
}

export function normalizeParamValue(value: ParamValueType) {
    return typeof value === "string" ? normalizeParamString(value) : value;
}

export function equalNormalizedParamValue(
    a: ParamValueType,
    b: ParamValueType,
) {
    return a === b || normalizeParamValue(a) === normalizeParamValue(b);
}

export function equalNormalizedParamObject(
    a: ParamObjectType = {},
    b: ParamObjectType = {},
) {
    return (
        normalizeParamString(JSON.stringify(a)) ===
        normalizeParamString(JSON.stringify(b))
    );
}

export type ParamValueType = string | number | boolean;

export type ParamFieldType =
    | ParamValueType
    | ParamObjectType
    | string[]
    | number[]
    | boolean[]
    | ParamObjectType[];

export type ParamObjectType = {
    [key: string]: ParamFieldType;
};

export interface FullAction extends AppAction {
    schemaName: string;
    parameters?: ParamObjectType;
}

export interface JSONAction {
    fullActionName: string;
    parameters?: ParamObjectType;
    resultEntityId?: string;
}

export interface ExecutableAction {
    action: TypeAgentAction<FullAction>;
    resultEntityId?: string;
}

export function createExecutableAction(
    schemaName: string,
    actionName: string,
    parameters?: ParamObjectType,
    resultEntityId?: string,
): ExecutableAction {
    const action: TypeAgentAction<FullAction> = {
        schemaName,
        actionName,
    };
    if (parameters !== undefined) {
        action.parameters = parameters;
    }

    const executableAction: ExecutableAction = {
        action,
    };
    if (resultEntityId !== undefined) {
        executableAction.resultEntityId = resultEntityId;
    }
    return executableAction;
}

const format =
    "'<request> => translator.action(<parameters>)' or '<request> => [ translator.action1(<parameters1>), translator.action2(<parameters2>), ... ]'";

function parseFullActionNameParts(fullActionName: string) {
    const parts = fullActionName.split(".");
    const schemaName = parts.slice(0, -1).join(".");
    const actionName = parts.at(-1)!;
    return { schemaName, actionName };
}

function parseAction(action: string, index: number = -1) {
    const leftParan = action.indexOf("(");
    if (leftParan === -1) {
        throw new Error(
            `${index !== -1 ? `Action ${index}: ` : ""}Missing '('. Input must be in the form of ${format}`,
        );
    }
    const functionName = action.substring(0, leftParan);
    const { schemaName, actionName } = parseFullActionNameParts(functionName);
    if (!actionName) {
        throw new Error(
            `${index !== -1 ? `Action ${index}: ` : ""}Unable to parse action name from '${functionName}'. Input must be in the form of ${format}`,
        );
    }
    if (action[action.length - 1] !== ")") {
        throw new Error(
            `${index !== -1 ? `Action ${index}: ` : ""}Missing terminating ')'. Input must be in the form of ${format}`,
        );
    }
    const paramStr = action.substring(leftParan + 1, action.length - 1).trim();
    let parameters: { [key: string]: ParamObjectType } | undefined;
    if (paramStr) {
        try {
            parameters = JSON.parse(paramStr);
        } catch (e: any) {
            throw new Error(
                `${index !== -1 ? `Action ${index}: ` : ""}Unable to parse parameters as JSON: '${paramStr}\n${e.message}'`,
            );
        }
    }
    return createExecutableAction(schemaName, actionName, parameters);
}

function parseActions(actionStr: string) {
    if (actionStr[actionStr.length - 1] !== "]") {
        `Missing terminating ']'. Input must be in the form of ${format}`;
    }
    const actions: ExecutableAction[] = [];
    // Remove the brackets
    let curr = actionStr.substring(1, actionStr.length - 1);

    // Try guessing the end of the action and try parsing it.
    let right = -1;
    while (true) {
        // Find the next possible end of the action
        right = curr.indexOf("}),", right + 1);
        if (right === -1) {
            // End of the list, try parse the error, and if it fails, the error propagates
            actions.push(parseAction(curr, actions.length + 1));
            break;
        }
        const action = curr.substring(0, right + 2);
        try {
            // Try to see if we can parse action.
            actions.push(parseAction(action, actions.length));
        } catch {
            // If not, it could be that the pattern is in a quote. Try to find the next possible end of the action
            continue;
        }
        curr = curr.substring(right + 3).trim();
        right = -1;
    }
    return actions;
}

export function getFullActionName(action: ExecutableAction) {
    return `${action.action.schemaName}.${action.action.actionName}`;
}

function parseExecutableActionsString(actions: string): ExecutableAction[] {
    return actions[0] === "[" ? parseActions(actions) : [parseAction(actions)];
}

function executableActionToString(action: ExecutableAction): string {
    return `${getFullActionName(action)}(${action.action.parameters ? JSON.stringify(action.action.parameters) : ""})`;
}

function executableActionsToString(actions: ExecutableAction[]): string {
    return actions.length !== 1
        ? `[${actions.map(executableActionToString).join(",")}]`
        : executableActionToString(actions[0]);
}

function fromJsonAction(actionJSON: JSONAction) {
    const { schemaName, actionName } = parseFullActionNameParts(
        actionJSON.fullActionName,
    );
    return createExecutableAction(
        schemaName,
        actionName,
        actionJSON.parameters,
        actionJSON.resultEntityId,
    );
}

export function fromJsonActions(
    actions: JSONAction | JSONAction[],
): ExecutableAction[] {
    return Array.isArray(actions)
        ? actions.map((a) => fromJsonAction(a))
        : [fromJsonAction(actions)];
}

function toJsonAction(action: ExecutableAction): JSONAction {
    const result: JSONAction = { fullActionName: getFullActionName(action) };
    if (action.action.parameters) {
        result.parameters = action.action.parameters;
    }
    if (action.resultEntityId) {
        result.resultEntityId = action.resultEntityId;
    }
    return result;
}

export function toJsonActions(
    actions: ExecutableAction[],
): JSONAction | JSONAction[] {
    return actions.length !== 1
        ? actions.map(toJsonAction)
        : toJsonAction(actions[0]);
}

export function toExecutableActions(actions: FullAction[]): ExecutableAction[] {
    return actions.map((action) => ({ action }));
}

export function toFullActions(actions: ExecutableAction[]): FullAction[] {
    return actions.map((a) => a.action);
}

export function getTranslationNamesForActions(
    actions: ExecutableAction[],
): string[] {
    return Array.from(new Set(actions.map((a) => a.action.schemaName))).sort();
}

export class RequestAction {
    public static readonly Separator = " => ";

    constructor(
        public readonly request: string,
        public readonly actions: ExecutableAction[],
        public readonly history?: HistoryContext,
    ) {}

    public toString() {
        return `${this.request}${RequestAction.Separator}${executableActionsToString(this.actions)}`;
    }

    public static fromString(input: string) {
        // Very simplistic parser for request/action.
        const trimmed = input.trim();
        const separator = trimmed.indexOf(RequestAction.Separator);
        if (separator === -1) {
            throw new Error(
                `'${RequestAction.Separator}' not found. Input must be in the form of ${format}`,
            );
        }
        const request = trimmed.substring(0, separator).trim();
        const actions = trimmed
            .substring(separator + RequestAction.Separator.length)
            .trim();

        return new RequestAction(
            request,
            parseExecutableActionsString(actions),
        );
    }

    public static create(
        request: string,
        actions: ExecutableAction | ExecutableAction[],
        history?: HistoryContext,
    ) {
        return new RequestAction(
            request,
            Array.isArray(actions) ? actions : [actions],
            history,
        );
    }
}

export function getPropertyInfo(
    propertyName: string,
    actions: ExecutableAction[],
): {
    action: FullAction;
    parameterName?: string;
    actionIndex: number | undefined;
} {
    const parts = propertyName.split(".");
    let firstPart = parts.shift();
    if (firstPart === undefined) {
        throw new Error(`Invalid property name '${propertyName}'`);
    }

    let action: FullAction | undefined;
    let actionIndex: number | undefined;
    if (actions.length > 1) {
        // Multiple actions
        actionIndex = parseInt(firstPart);
        if (!isNaN(actionIndex) && actionIndex.toString() === firstPart) {
            action = actions[actionIndex].action;
        }
        if (action === undefined) {
            throw new Error(
                `Invalid index '${firstPart}' in property name '${propertyName}'`,
            );
        }
        firstPart = parts.shift();
    } else {
        action = actions[0].action;
    }
    if (firstPart === "fullActionName" && parts.length === 0) {
        return { action, actionIndex };
    }
    if (firstPart !== "parameters" || parts.length === 0) {
        throw new Error(`Invalid property name '${propertyName}'`);
    }
    return { action, parameterName: parts.join("."), actionIndex };
}
