// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { RequestAction } from "./requestAction.js";
import { Construction } from "../constructions/constructions.js";
import { ValidationError } from "./typeChatAgent.js";
import { SchemaInfoProvider } from "./schemaInfoProvider.js";

export type CorrectionRecord<T> = {
    data: T;
    correction: ValidationError;
};
type GenericExplanationSuccess<T> = {
    success: true;
    data: T;
    corrections?: CorrectionRecord<T>[];
    construction?: Construction; // Return the construction if the explainer supports it
};

type GenericExplanationError<T> = {
    success: false;
    message: string;
    corrections?: CorrectionRecord<T>[];
};

export type GenericExplanationResult<T extends object = object> =
    | GenericExplanationSuccess<T>
    | GenericExplanationError<T>;

export type ExplanationValidator<T> = (
    requestAction: RequestAction,
    explanation: T,
) => string | undefined;

export type ExplainerConfig = {
    constructionCreationConfig: ConstructionCreationConfig | undefined;
};

export type ConstructionCreationConfig = {
    schemaInfoProvider?: SchemaInfoProvider | undefined;
};

export type ConstructionFactory<T> = (
    requestAction: RequestAction,
    explanation: T,
    constructionCreationConfig: ConstructionCreationConfig,
) => Construction;

type ToPrettyString<T> = (explanation: T) => string;

export interface GenericExplainer<T extends object = object> {
    generate(
        requestAction: RequestAction,
        config?: ExplainerConfig,
    ): Promise<GenericExplanationResult<T>>;

    correct?(
        requestAction: RequestAction,
        explanation: T,
        correction: ValidationError,
    ): Promise<GenericExplanationResult<T>>;

    validate(
        requestAction: RequestAction,
        explanation: T,
        config?: ExplainerConfig,
    ): ValidationError | undefined;
    createConstruction?: ConstructionFactory<any> | undefined;

    toPrettyString?: ToPrettyString<any> | undefined;
}
