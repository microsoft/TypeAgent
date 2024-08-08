// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PromptSection, TypeChatLanguageModel } from "typechat";
import { createJsonTranslatorFromFile } from "common-utils";
import { RequestAction, HistoryContext } from "./requestAction.js";
import {
    GenericExplanationResult,
    ExplanationValidator,
    ConstructionFactory,
    CreateConstructionInfo,
} from "./genericExplainer.js";
import {
    GenericTypeChatAgent,
    TypeChatAgent,
    ValidationError,
} from "./typeChatAgent.js";

export function getExactStringRequirementMessage(
    subphraseText: boolean = true,
) {
    const name: string = subphraseText ? "Sub-phrase text" : "Substring";
    const wholdWords = subphraseText ? ", include whole words and" : "and";
    return `${name} must be exact copy of part of the original request ${wholdWords} is not changed by correcting misspelling or grammar.`;
}

export function getSubphraseExplanationInstruction() {
    return `Break the words of Request into non-overlapping phrases in exactly the order they appear and explain the role of each phrase in the translation. ${getExactStringRequirementMessage()}`;
}

/**
 * Return instructions needed to set up an explainer
 * @param requestAction
 * @returns
 */
export function buildExplanationInstructions(
    requestAction: RequestAction,
): PromptSection[] {
    const instr: PromptSection[] = [
        {
            role: "system",
            content:
                "The user is supplying a translation of the form Request => Action.\n" +
                `${getSubphraseExplanationInstruction()}\n${getActionDescription(
                    requestAction,
                )}`,
        },
    ];
    return instr;
}

function getContextPart(history?: HistoryContext) {
    if (history && history.entities.length > 0) {
        const contextNames = history.entities.map((c, i) => {
            return { index: i, entity: c.name };
        });
        return `\n. The entities in the conversation history in a JSON array is: ${JSON.stringify(contextNames)}.`;
    }
    return "";
}
export function getActionDescription(
    requestAction: RequestAction,
    parameterOnly: boolean = true,
) {
    const names = parameterOnly ? "parameters" : "properties";
    const name = parameterOnly ? "parameter" : "property";
    const actions = requestAction.actions;
    const action = actions.action;
    const paramNames = getLeafNames(
        parameterOnly && action !== undefined
            ? action.parameters
            : actions.toJSON(),
    );
    let paramPart = "";
    if (paramNames.length > 0) {
        paramPart = `The ${name} name${
            paramNames.length > 1 ? "s are " : " is "
        }${paramNames.join(", ")}.`;
    } else {
        paramPart = `There are no ${names}.`;
    }
    const actionNamePart =
        parameterOnly && action !== undefined
            ? `The action name is ${action.actionName}. `
            : "";

    return `${actionNamePart}${paramPart}${getContextPart(requestAction.history)}`;
}

function getLeafNames(params: any) {
    const names: string[] = [];
    for (const [key, value] of Object.entries(params)) {
        if (typeof value === "object") {
            const children = getLeafNames(value);
            for (const child of children) {
                names.push(`${key}.${child}`);
            }
        } else if (typeof value === "function") {
            throw new Error("Function is not supported as an action value");
        } else {
            names.push(key);
        }
    }
    return names;
}

export class Explainer<T extends object> {
    constructor(
        private readonly agent: GenericTypeChatAgent<RequestAction, T>,
        public readonly createConstruction?: ConstructionFactory<T>,
        public readonly toPrettyString?: (explanation: T) => string,
        public readonly augmentExplanation?: (
            explanation: T,
            requestAction: RequestAction,
            createConstructionInfo: CreateConstructionInfo,
        ) => Promise<void>,
    ) {}

    public validate(requestAction: RequestAction, explanation: T) {
        return this.agent.validate?.(requestAction, explanation);
    }

    public async generate(
        requestAction: RequestAction,
        createConstructionInfo?: CreateConstructionInfo, // create construction if information is provided.
    ): Promise<GenericExplanationResult<T>> {
        const result: GenericExplanationResult<T> =
            await this.agent.run(requestAction);
        if (
            result.success &&
            this.augmentExplanation &&
            createConstructionInfo
        ) {
            await this.augmentExplanation(
                result.data,
                requestAction,
                createConstructionInfo,
            );
        }
        if (
            result.success &&
            createConstructionInfo &&
            this.createConstruction
        ) {
            result.construction = this.createConstruction(
                requestAction,
                result.data,
                createConstructionInfo,
            );
        }

        return result;
    }

    public async correct(
        requestAction: RequestAction,
        explanation: T,
        correction: ValidationError,
    ) {
        if (!this.agent.correct) {
            throw new Error("Explainer doesn't support correction");
        }
        return this.agent.correct(requestAction, explanation, correction);
    }
}

type ExplainerConfig = {
    schemaFile: string;
    schemaType: string;
    createPromptPreamble?: (requestAction: RequestAction) => PromptSection[];
    validate?: ExplanationValidator<any>;
    createConstruction?: ConstructionFactory<any>;
    model?: TypeChatLanguageModel; // use a custom model impl
};

export function createExplainer<T extends object>(config: ExplainerConfig) {
    const createPromptPreamble =
        config.createPromptPreamble ?? buildExplanationInstructions;
    const agent = new TypeChatAgent(
        "explanation",
        () =>
            createJsonTranslatorFromFile<T>(
                config.schemaType,
                config.schemaFile,
                undefined,
                undefined,
                config.model,
            ),
        (input) => createPromptPreamble(input),
        (input) => input.toString(),
        config.validate,
    );
    return new Explainer<T>(agent, config.createConstruction);
}
