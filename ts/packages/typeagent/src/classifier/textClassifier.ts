// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    Result,
    TypeChatLanguageModel,
    createJsonTranslator,
    TypeChatJsonTranslator,
    PromptSection,
    success,
} from "typechat";
import { createTypeScriptJsonValidator } from "typechat/ts";

const classificationSchemaText = `// The schema for Class object
export type Class = {
    className: string;
    description: string;
};

// The schema for the classification response.
export interface ClassificationResponse {
  // className from classification table
  className: string;
}
`;

export type Class = {
    className: string;
    description: string;
};

export interface ClassificationResponse {
    className: string;
}

export interface TextClassifier<InputType> {
    translator: TypeChatJsonTranslator<ClassificationResponse>;
    classes: Class[];
    classify(
        query: InputType,
        context?: PromptSection[],
    ): Promise<Result<ClassificationResponse>>;
    addClass(newClass: Class): Promise<void>;
}

export async function createTextClassifier<InputType = string>(
    model: TypeChatLanguageModel,
    existingClasses?: Class[],
): Promise<TextClassifier<InputType>> {
    const utils = await import("common-utils");
    const classes: Class[] = existingClasses ?? [];
    const validator = createTypeScriptJsonValidator<ClassificationResponse>(
        classificationSchemaText,
        "ClassificationResponse",
    );
    const translator = createJsonTranslator<ClassificationResponse>(
        model,
        validator,
    );

    const constraintsValidator =
        utils.createConstraintsValidator<ClassificationResponse>(
            (action, context) => validateConstraints(action, context),
        );

    translator.validateInstance = constraintsValidator.validateConstraints;

    const classifier: TextClassifier<InputType> = {
        translator,
        classes,
        classify,
        addClass,
    };

    async function validateConstraints(
        action: ClassificationResponse,
        context: any,
    ): Promise<void> {
        if (!action.className) {
            context.addDiagnostic("Error", "Missing class name");
        }
        if (
            !action.className ||
            !classes.some((c) => c.className === action.className)
        ) {
            const vocab: string = classes.map((c) => c.className).join(", ");
            context.addDiagnostic(
                "Error",
                `'${action.className}' does not exist. Permitted values: ${vocab}`,
            );
        }
    }

    async function classify(
        query: InputType,
        context?: PromptSection[],
    ): Promise<Result<ClassificationResponse>> {
        const initClasses: string = JSON.stringify(classes, undefined);
        const fullRequest: string = `Classify "${query}" using the following classification table:\n${initClasses}\n`;
        return await translator.translate(fullRequest, context);
    }

    async function addClass(newClassOrClasses: Class | Class[]): Promise<void> {
        if (Array.isArray(newClassOrClasses)) {
            classes.push(...newClassOrClasses);
        } else {
            classes.push(newClassOrClasses);
        }
    }

    return classifier;
}

export async function classify(
    model: TypeChatLanguageModel,
    classes: Class[],
    query: string,
    context?: PromptSection[],
): Promise<Result<string>> {
    const classifier = await createTextClassifier(model, classes);
    const result = await classifier.classify(query, context);
    if (!result.success) {
        return result;
    }
    return success(result.data.className);
}
