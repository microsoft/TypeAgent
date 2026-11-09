// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { WikiContent } from "./viewTypes.js";
import {
    informationalWiki,
    validateInformationalContent,
} from "./informationalWiki.js";
export { wikiIndex } from "./viewContent.js";

export function validateWiki(content: WikiContent): void {
    if (!informationalWiki(content))
        throw new Error("Wiki construction requires informational-wiki-v1");
    validateInformationalContent(content);
}
