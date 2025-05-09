// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { describeIf, hasTestKeys, parseCommandArgs } from "test-lib";
import { IConversation } from "../src/interfaces.js";
import { createSearchQueryTranslator } from "../src/searchQueryTranslator.js";
import {
    emptyConversation,
    getTestChatModel,
    loadTestConversationForOnline,
    loadTestQueries,
    runSearchConversation,
} from "./testCommon.js";
import { resolveAndVerifyKnowledgeMatches } from "./verify.js";
import { searchQueryExprFromLanguage } from "../src/searchLang.js";

describeIf(
    "searchQueryTranslator.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        let conversation: IConversation = emptyConversation();
        let translator = createSearchQueryTranslator(getTestChatModel());

        beforeAll(async () => {
            conversation = await loadTestConversationForOnline();
        });

        test(
            "search.queries",
            async () => {
                let queries = loadTestQueries(
                    "./test/data/Episode_53_nlpQuery.txt",
                    100,
                );
                for (const query of queries) {
                    const cmd = parseCommandArgs(query);
                    if (cmd.namedArgs?.query) {
                        const result = await searchQueryExprFromLanguage(
                            conversation,
                            translator,
                            cmd.namedArgs.query,
                        );
                        expect(result.success).toBeTruthy();
                        if (!result.success) {
                            return;
                        }
                        for (const searchQuery of result.data
                            .queryExpressions) {
                            for (const expr of searchQuery.selectExpressions) {
                                const searchResults =
                                    await runSearchConversation(
                                        conversation,
                                        expr.searchTermGroup,
                                        expr.when,
                                    );
                                resolveAndVerifyKnowledgeMatches(
                                    conversation,
                                    searchResults,
                                );
                            }
                        }
                    }
                }
            },
            testTimeout,
        );
    },
);
