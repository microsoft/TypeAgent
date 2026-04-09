// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    describeIf,
    hasTestKeys,
    parseCommandArgs,
    verifyResult,
} from "test-lib";
import {
    emptyConversation,
    getTestChatModel,
    loadTestConversationForOnline,
    loadTestQueries,
} from "./testCommon.js";
import { IConversation } from "../src/interfaces.js";
import { createSearchQueryTranslator } from "../src/searchQueryTranslator.js";
import {
    createLanguageSearchOptions,
    searchConversationWithLanguage,
} from "../src/searchLang.js";
import { verifyAnswerResponse, verifySearchResults } from "./verify.js";
import {
    AnswerGenerator,
    createAnswerGeneratorSettings,
    generateAnswer,
} from "../src/answerGenerator.js";

describeIf(
    "answerGenerator.online",
    () => hasTestKeys(),
    () => {
        const testTimeout = 5 * 60 * 1000;
        let conversation: IConversation = emptyConversation();
        let knowledgeModel = getTestChatModel();
        let queryTranslator = createSearchQueryTranslator(knowledgeModel);
        beforeAll(async () => {
            conversation = await loadTestConversationForOnline();
        });

        test("answer.createGenerator", () => {
            expect(
                () =>
                    new AnswerGenerator(
                        createAnswerGeneratorSettings(knowledgeModel),
                    ),
            ).not.toThrow();
        });

        test(
            "answer.generate",
            async () => {
                let testQueries = loadTestQueries(
                    "./test/data/Episode_53_nlpAnswer.txt",
                );
                let searchOptions = createLanguageSearchOptions();
                const answerGenerator = new AnswerGenerator(
                    createAnswerGeneratorSettings(knowledgeModel),
                );
                for (const testQuery of testQueries) {
                    const cmd = parseCommandArgs(testQuery);
                    const question = cmd.namedArgs?.query;
                    if (question) {
                        // Get search result first
                        const results = await searchConversationWithLanguage(
                            conversation!,
                            question,
                            queryTranslator,
                            searchOptions,
                        );
                        verifyResult(results, (data) =>
                            verifySearchResults(data),
                        );
                        if (results.success) {
                            const response = await generateAnswer(
                                conversation,
                                answerGenerator,
                                question,
                                results.data,
                            );
                            verifyResult(response, (data) =>
                                verifyAnswerResponse(data),
                            );
                        }
                    }
                }
            },
            testTimeout,
        );
    },
);
