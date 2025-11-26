// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslatorFromFile } from "typechat-utils";
import { RequestAction } from "../requestAction.js";
import { TypeChatAgent } from "../typeChatAgent.js";
import { getPackageFilePath } from "../../utils/getPackageFilePath.js";
import { PromptSection } from "typechat";
import { form, requestActionToPromptString } from "./explanationV5.js";
import { ExplainerConfig } from "../genericExplainer.js";
import { PolitenessGeneralization } from "./politenessGeneralizationSchemaV5.js";

function createInstructions(requestAction: RequestAction): PromptSection[] {
    const instructions: string[] = [
        `${form} with the following value:\n${requestActionToPromptString(requestAction)}`,
        "Generate 4 politeness prefix and suffix that can be added to the request but doesn't change the action",
    ];

    return [
        {
            role: "system",
            content: instructions.join("\n"),
        },
    ];
}

export type PolitenessGeneralizer = TypeChatAgent<
    RequestAction,
    PolitenessGeneralization,
    ExplainerConfig
>;

export function createPolitenessGeneralizer(
    model?: string,
): PolitenessGeneralizer {
    return new TypeChatAgent(
        "politeness generalization",
        () => {
            return createJsonTranslatorFromFile<PolitenessGeneralization>(
                "PolitenessGeneralization",
                getPackageFilePath(
                    "./src/explanation/v5/politenessGeneralizationSchemaV5.ts",
                ),
                { model },
            );
        },
        createInstructions,
        (requestAction) => requestActionToPromptString(requestAction),
    );
}
