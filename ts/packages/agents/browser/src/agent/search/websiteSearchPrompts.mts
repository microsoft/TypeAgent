// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { PromptSection } from "typechat";
import type { WebsiteCollection } from "website-memory";

export function getWebsiteSearchPromptPreamble(
    websiteCollection: WebsiteCollection,
): PromptSection[] {
    return [
        {
            role: "system",
            content: `Searching WEB KNOWLEDGE BASE (bookmarked pages, browsing history).

Schema interpretations for web:
- EntityTerm.type: repository, article, documentation, tutorial, blog
- EntityTerm.facets: domain(github.com), pageType(doc), source(bookmark)
- ActionTerm verbs: bookmarked, visited, read, saved
- actorEntities: "*" means user`,
        },
    ];
}
