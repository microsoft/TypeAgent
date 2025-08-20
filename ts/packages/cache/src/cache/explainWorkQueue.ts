// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { QueueObject, queue } from "async";
import {
    getTranslationNamesForActions,
    normalizeParamString,
    RequestAction,
} from "../explanation/requestAction.js";
import { ExplainerFactory } from "./factory.js";
import { getLanguageTools } from "../utils/language.js";
import {
    ConstructionCreationConfig,
    GenericExplanationResult,
} from "../explanation/genericExplainer.js";

const langTool = getLanguageTools("en");

function checkExplainableValues(
    requestAction: RequestAction,
    valueInRequest: boolean,
    noReferences: boolean,
) {
    // Do a cheap parameter check first.
    const normalizedRequest = normalizeParamString(requestAction.request);
    const pending: unknown[] = [];

    for (const { action } of requestAction.actions) {
        pending.push(action.parameters);
    }

    while (pending.length > 0) {
        const value = pending.pop();
        if (!value) {
            continue;
        }

        // TODO: check number too.
        if (typeof value === "string") {
            if (noReferences && langTool?.possibleReferentialPhrase(value)) {
                throw new Error(
                    "Request contains a possible referential phrase used for property values.",
                );
            }
            if (
                valueInRequest &&
                !normalizedRequest.includes(normalizeParamString(value))
            ) {
                throw new Error(
                    `Action parameter value '${value}' not found in the request`,
                );
            }
            continue;
        }
        if (typeof value === "object") {
            if (Array.isArray(value)) {
                pending.push(...value);
            } else {
                pending.push(...Object.values(value));
            }
        }
    }
}

export type ExplanationOptions = {
    namespaceSuffix?: string | undefined; // suffix to add to namespace keys
    concurrent?: boolean; // whether to limit to run one at a time, require cache to be false
    valueInRequest?: boolean;
    noReferences?: boolean;
    checkExplainable?:
        | ((requestAction: RequestAction) => Promise<void>)
        | undefined; // throw exception if not explainable
};

export type ProcessExplanationResult = {
    explanation: GenericExplanationResult;
    elapsedMs: number;
    toPrettyString?: ((explanation: object) => string) | undefined;
};

export class ExplainWorkQueue {
    private queue: QueueObject<{
        task: () => Promise<ProcessExplanationResult>;
        resolve: (value: ProcessExplanationResult) => void;
        reject: (reason?: any) => void;
    }>;

    constructor(public readonly getExplainerForTranslator: ExplainerFactory) {
        this.queue = queue(async (item, callback) => {
            try {
                item.resolve(await item.task());
            } catch (e: any) {
                item.reject(e);
            }
        });
    }

    public async queueTask(
        requestAction: RequestAction,
        cache: boolean,
        options?: ExplanationOptions,
        constructionCreationConfig?: ConstructionCreationConfig,
        model?: string,
    ): Promise<ProcessExplanationResult> {
        const concurrent = options?.concurrent ?? false;
        const valueInRequest = options?.valueInRequest ?? true;
        const noReferences = options?.noReferences ?? true;
        const checkExplainable = options?.checkExplainable;

        checkExplainableValues(requestAction, valueInRequest, noReferences);

        const task = async () => {
            const startTime = performance.now();
            const actions = requestAction.actions;
            const explainer = this.getExplainerForTranslator(
                getTranslationNamesForActions(actions),
                model,
            );
            const explainerConfig = {
                constructionCreationConfig,
            };

            await checkExplainable?.(requestAction);
            const explanation = await explainer.generate(
                requestAction,
                explainerConfig,
            );
            const elapsedMs = performance.now() - startTime;

            return {
                explanation,
                elapsedMs,
                toPrettyString: explainer.toPrettyString,
            };
        };

        if (concurrent && !cache) {
            return task();
        }
        return new Promise((resolve, reject) => {
            this.queue.push({
                task,
                resolve,
                reject,
            });
        });
    }
}
