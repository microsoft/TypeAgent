// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
