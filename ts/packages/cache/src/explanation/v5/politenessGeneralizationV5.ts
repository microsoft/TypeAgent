// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createJsonTranslatorFromFile } from "common-utils";
import { RequestAction } from "../requestAction.js";
import { TypeChatAgent } from "../typeChatAgent.js";
import { getPackageFilePath } from "../../utils/getPackageFilePath.js";
import { PromptSection } from "typechat";
import { form } from "./explanationV5.js";
import { ExplainerConfig } from "../genericExplainer.js";
import { PolitenessGeneralization } from "./politenessGeneralizationSchemaV5.js";

function createInstructions(requestAction: RequestAction): PromptSection[] {
    const instructions: string[] = [
        form,
        "Generate 4 request with added politeness prefix and suffix that doesn't change the action",
    ];

    return [
        {
            role: "system",
            content: instructions.join("\n"),
        },
    ];
}

export type PolitenessGenerializer = TypeChatAgent<
    RequestAction,
    PolitenessGeneralization,
    ExplainerConfig
>;

export function createPolitenessGeneralizer(
    model?: string,
): PolitenessGenerializer {
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
        (requestAction) => requestAction.toPromptString(),
    );
}
