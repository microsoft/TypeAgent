// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { getObjectPropertyNames } from "common-utils";
import {
    RequestAction,
    HistoryContext,
    toJsonActions,
} from "./requestAction.js";
import {
    GenericExplanationResult,
    ConstructionFactory,
    ConstructionCreationConfig,
    ExplainerConfig,
} from "./genericExplainer.js";
import { GenericTypeChatAgent, ValidationError } from "./typeChatAgent.js";

export function getExactStringRequirementMessage(
    subphraseText: boolean = true,
) {
    const name: string = subphraseText ? "Sub-phrase text" : "Substring";
    const wholeWords = subphraseText ? ", include whole words and" : "and";
    return `${name} must be exact copy of part of the original request ${wholeWords} is not changed by correcting misspelling or grammar.`;
}

export function getSubphraseExplanationInstruction() {
    return `Break the words of Request into non-overlapping phrases in exactly the order they appear and explain the role of each phrase in the translation. ${getExactStringRequirementMessage()}`;
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

export function getActionDescription(requestAction: RequestAction) {
    const actions = requestAction.actions;
    const leafPropertyNames = getObjectPropertyNames(toJsonActions(actions));
    let propertyPart = "";
    if (leafPropertyNames.length > 0) {
        propertyPart = `The property name${
            leafPropertyNames.length > 1 ? "s are " : " is "
        }${leafPropertyNames.join(", ")}.`;
    } else {
        propertyPart = `There are no properties.`;
    }

    return `${propertyPart} Ignore properties that are not listed. ${getContextPart(requestAction.history)}`;
}

export class Explainer<T extends object> {
    constructor(
        private readonly agent: GenericTypeChatAgent<
            RequestAction,
            T,
            ExplainerConfig
        >,
        public readonly createConstruction?: ConstructionFactory<T>,
        public readonly toPrettyString?: (explanation: T) => string,
        public readonly augmentExplanation?: (
            explanation: T,
            requestAction: RequestAction,
            constructionCreationConfig: ConstructionCreationConfig,
        ) => Promise<void>,
    ) {}

    public validate(
        requestAction: RequestAction,
        explanation: T,
        config?: ExplainerConfig,
    ) {
        return this.agent.validate?.(requestAction, explanation, config);
    }

    public async generate(
        requestAction: RequestAction,
        config?: ExplainerConfig, // create construction if information is provided.
    ): Promise<GenericExplanationResult<T>> {
        const result: GenericExplanationResult<T> = await this.agent.run(
            requestAction,
            config,
        );
        const constructionCreationConfig = config?.constructionCreationConfig;
        if (
            result.success &&
            this.augmentExplanation &&
            constructionCreationConfig
        ) {
            await this.augmentExplanation(
                result.data,
                requestAction,
                constructionCreationConfig,
            );
        }
        if (
            result.success &&
            constructionCreationConfig &&
            this.createConstruction
        ) {
            result.construction = this.createConstruction(
                requestAction,
                result.data,
                constructionCreationConfig,
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
