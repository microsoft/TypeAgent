// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import assert from "assert";
import dotenv from "dotenv";
import findConfig from "find-config";
import fs from "fs";

import { PromptSection } from "typechat";

export type HtmlFragments = {
    frameId: string;
    content: string;
    text?: string;
    cssSelector?: string;
};

export interface MultimodalPromptSection
    extends Omit<PromptSection, "content"> {
    /**
     * Specifies the role of this section.
     */
    role: "system" | "user" | "assistant";
    /**
     * Specifies the content of this section.
     */
    content: string | ContentSection[];
}

export interface ContentSection {
    type: "text" | "image_url";
    text?: string;
    image_url?: {
        url: string;
    };
}

export function getModelVals(
    model: "GPT_35_TURBO" | "GPT_4" | "GPT-v" | "GPT_4o",
) {
    const dotEnvPath = findConfig(".env");
    assert(dotEnvPath, ".env file not found!");
    const vals = dotenv.parse(fs.readFileSync(dotEnvPath));

    switch (model) {
        case "GPT_35_TURBO": {
            vals["AZURE_OPENAI_API_KEY"] =
                vals["AZURE_OPENAI_API_KEY_GPT_35_TURBO"];
            vals["AZURE_OPENAI_ENDPOINT"] =
                vals["AZURE_OPENAI_ENDPOINT_GPT_35_TURBO"];
            break;
        }
        case "GPT_4o": {
            vals["AZURE_OPENAI_API_KEY"] = vals["AZURE_OPENAI_API_KEY_GPT_4_O"];
            vals["AZURE_OPENAI_ENDPOINT"] =
                vals["AZURE_OPENAI_ENDPOINT_GPT_4_O"];
            break;
        }
        case "GPT-v": {
            vals["AZURE_OPENAI_API_KEY"] = vals["AZURE_OPENAI_API_KEY_GPT_v"];
            vals["AZURE_OPENAI_ENDPOINT"] = vals["AZURE_OPENAI_ENDPOINT_GPT_v"];
            break;
        }
    }

    return vals;
}
