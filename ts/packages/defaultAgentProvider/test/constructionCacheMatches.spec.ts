// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { AgentCache, getDefaultExplainerName } from "agent-cache";
import { getImportedCache } from "./constructionCacheTestCommon.js";

const explainer = getDefaultExplainerName();

describe("construction cache", () => {
    // Make sure that construction store can match some variations (from the demo script)
    describe("import merged cache matches", () => {
        let cacheP: Promise<AgentCache> | undefined;
        const tests = [
            "begin playing the Deutsche Motette by Richard Strauss",
            "Please play Symphony No. 8 by Shostakovich.",
            "if you don't mind, begin playing a selection of Phillip Glass for us?",
            "I want to listen to a selection of Johann Sebastian Bach",
        ];
        it.each(tests)("%s", async (request) => {
            if (cacheP === undefined) {
                cacheP = getImportedCache(explainer, true);
            }
            const cache = await cacheP;
            const matched = cache.constructionStore.match(request);

            // Able to match using the cached information
            expect(matched.length).not.toEqual(0);
        });
    });
});
