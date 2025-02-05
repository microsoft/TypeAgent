// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection } from "typechat";
import { AppAction, Entity } from "@typeagent/agent-sdk";

export type PromptEntity = Entity & {
    sourceAppAgentName: string;
};

export type HistoryContext = {
    promptSections: PromptSection[];
    entities: PromptEntity[];
    additionalInstructions?: string[] | undefined;
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
    translatorName: string;
    parameters?: ParamObjectType;
}

export interface JSONAction {
    fullActionName: string;
    parameters?: ParamObjectType;
}

function parseActionNameParts(fullActionName: string) {
    const parts = fullActionName.split(".");
    const translatorName = parts.slice(0, -1).join(".");
    const actionName = parts.at(-1)!;
    return { translatorName, actionName };
}

export class Action {
    constructor(
        public readonly translatorName: string,
        public readonly actionName: string,
        public readonly parameters: ParamObjectType | undefined,
        public readonly resultEntityId?: string,
    ) {}

    public get fullActionName() {
        return `${this.translatorNameString}.${this.actionName}`;
    }

    public get translatorNameString(): string {
        return this.translatorName;
    }
    public toString() {
        return `${this.fullActionName}(${this.parameters ? JSON.stringify(this.parameters) : ""})`;
    }
    public toJSON(): JSONAction {
        const result: JSONAction = { fullActionName: this.fullActionName };
        if (this.parameters) {
            result.parameters = this.parameters;
        }
        return result;
    }

    public static fromJSONObject(actionJSON: JSONAction): Action {
        const { translatorName, actionName } = parseActionNameParts(
            actionJSON.fullActionName,
        );
        return new Action(translatorName, actionName, actionJSON.parameters);
    }

    public toFullAction(): FullAction {
        const result: FullAction = {
            translatorName: this.translatorName,
            actionName: this.actionName,
        };
        if (this.parameters) {
            result.parameters = this.parameters;
        }
        return result;
    }
    public static fromFullAction(fullAction: FullAction): Action {
        return new Action(
            fullAction.translatorName,
            fullAction.actionName,
            fullAction.parameters,
        );
    }
}

export class Actions {
    constructor(private readonly actions: Action | Action[]) {}

    public get data() {
        return this.actions;
    }
    public get action() {
        return Array.isArray(this.actions) ? undefined : this.actions;
    }

    // Sorted array of unique translator names
    public get translatorNames(): string[] {
        return Array.isArray(this.actions)
            ? Array.from(
                  new Set(
                      this.actions.map((a) => a.translatorNameString),
                  ).values(),
              ).sort() // sort it so that it is stable.
            : [this.actions.translatorNameString];
    }

    public get(index: number) {
        return Array.isArray(this.actions)
            ? this.actions[index]
            : index === 0
              ? this.action
              : undefined;
    }
    public [Symbol.iterator](): Iterator<Action> {
        if (Array.isArray(this.actions)) {
            return this.actions[Symbol.iterator]();
        }
        let action: Action | undefined = this.actions;
        return {
            next() {
                if (action !== undefined) {
                    const ret = { value: action, done: false };
                    action = undefined;
                    return ret;
                }
                return { value: undefined, done: true };
            },
        };
    }

    public static fromJSON(actionJSON: JSONAction | JSONAction[]): Actions {
        return new Actions(
            Array.isArray(actionJSON)
                ? actionJSON.map((a) => Action.fromJSONObject(a))
                : Action.fromJSONObject(actionJSON),
        );
    }

    public toJSON() {
        return Array.isArray(this.actions)
            ? this.actions.map((a) => a.toJSON())
            : this.actions.toJSON();
    }

    public toFullActions(): FullAction[] {
        return Array.isArray(this.actions)
            ? this.actions.map((a) => a.toFullAction())
            : [this.actions.toFullAction()];
    }

    public static fromFullActions(fullAction: FullAction[]): Actions {
        return new Actions(
            fullAction.length === 1
                ? Action.fromFullAction(fullAction[0])
                : fullAction.map((a) => Action.fromFullAction(a)),
        );
    }
    public toString() {
        return Array.isArray(this.actions)
            ? `[${this.actions.join(",")}]`
            : this.actions.toString();
    }
    public static fromString(actions: string) {
        return new Actions(
            actions[0] === "[" ? parseActions(actions) : parseAction(actions),
        );
    }
}

const format =
    "'<request> => translator.action(<parameters>)' or '<request> => [ translator.action1(<parameters1>), translator.action2(<parameters2>), ... ]'";

function parseAction(action: string, index: number = -1) {
    const leftParan = action.indexOf("(");
    if (leftParan === -1) {
        throw new Error(
            `${index !== -1 ? `Action ${index}: ` : ""}Missing '('. Input must be in the form of ${format}`,
        );
    }
    const functionName = action.substring(0, leftParan);
    const { translatorName, actionName } = parseActionNameParts(functionName);
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
    return new Action(translatorName, actionName, parameters);
}

function parseActions(actionStr: string) {
    if (actionStr[actionStr.length - 1] !== "]") {
        `Missing terminating ']'. Input must be in the form of ${format}`;
    }
    const actions: Action[] = [];
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

export class RequestAction {
    public static readonly Separator = " => ";

    constructor(
        public readonly request: string,
        public readonly actions: Actions,
        public readonly history?: HistoryContext,
    ) {}

    public toString() {
        return `${this.request}${RequestAction.Separator}${this.actions}`;
    }

    public toPromptString() {
        return JSON.stringify(
            {
                request: this.request,
                actions: this.actions,
            },
            undefined,
            2,
        );
    }
    public static fromString(input: string) {
        // Very simplistic parser for request/action.
        const trimmed = input.trim();
        const separator = trimmed.indexOf(RequestAction.Separator);
        if (separator === -1) {
            throw new Error(
                `'=>' not found. Input must be in the form of ${format}`,
            );
        }
        const request = trimmed.substring(0, separator).trim();
        const actions = trimmed
            .substring(separator + RequestAction.Separator.length)
            .trim();

        return new RequestAction(request, Actions.fromString(actions));
    }

    public static create(
        request: string,
        actions: Action | Action[],
        history?: HistoryContext,
    ) {
        return new RequestAction(request, new Actions(actions), history);
    }
}
