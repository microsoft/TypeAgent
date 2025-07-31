// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    arg,
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
    parseTypedArguments,
    ProgressBar,
} from "interactive-app";
import { KnowproContext, searchDef } from "./knowproMemory.js";
import { argDestFile, argSourceFile } from "../common.js";
import * as kp from "knowpro";
import * as kpTest from "knowpro-test";
import * as cm from "conversation-memory";
import * as tp from "textpro";
import {
    changeFileExt,
    getAbsolutePath,
    getFileName,
    readAllText,
} from "typeagent";
import chalk from "chalk";
import { openai } from "aiclient";
import * as fs from "fs";
import {
    createIndexingEventHandler,
    sourcePathToMemoryIndexPath,
} from "./knowproCommon.js";
import path from "path";
import assert from "assert";

/**
 * Test related commands
 */

export async function createKnowproTestCommands(
    context: KnowproContext,
    commands: Record<string, CommandHandler>,
) {
    commands.kpLoadTestIndex = loadTestIndex;
    commands.kpTestSearchBatch = searchBatch;
    commands.kpTestVerifySearchBatch = verifySearchBatch;
    commands.kpTestAnswerBatch = answerBatch;
    commands.kpTestVerifyAnswerBatch = verifyAnswerBatch;
    commands.kpTestHtml = testHtml;
    commands.kpTestHtmlText = testHtmlText;
    commands.kpTestHtmlMd = testHtmlMd;
    commands.kpTestHtmlParts = testHtmlParts;
    commands.kpTestChoices = testMultipleChoice;
    commands.kpTestSearch = testSearchScope;

    async function testHtml(args: string[]) {
        const html = await readAllText(args[0]);
        const simpleHtml = tp.simplifyHtml(html);
        context.printer.writeLine(simpleHtml);
    }

    async function testHtmlText(args: string[]) {
        const html = await readAllText(args[0]);
        const text = tp.htmlToText(html);
        context.printer.writeLine(text);
    }

    function testHtmlMdDef(): CommandMetadata {
        return {
            description: "Html to MD",
            args: {
                filePath: arg("File path"),
            },
            options: {
                rootTag: arg("Root tag", "body"),
            },
        };
    }
    commands.kpTestHtmlMd.metadata = testHtmlMdDef();
    async function testHtmlMd(args: string[]) {
        const namedArgs = parseNamedArguments(args, testHtmlMdDef());
        const filePath = namedArgs.filePath;
        if (!filePath) {
            return;
        }
        let html = await readAllText(filePath);
        let markdown = tp.htmlToMarkdown(html, namedArgs.rootTag);
        context.printer.writeLine(markdown);

        const destPath = changeFileExt(filePath, ".md");
        fs.writeFileSync(destPath, markdown);

        let mdDom = tp.tokenizeMarkdown(markdown);
        context.printer.writeJsonInColor(chalk.gray, mdDom);

        const [textBlocks, knowledgeBlocks] =
            tp.textAndKnowledgeBlocksFromMarkdown(mdDom);
        assert(textBlocks.length === knowledgeBlocks.length);
        for (let i = 0; i < textBlocks.length; ++i) {
            context.printer.writeLine("=====");
            context.printer.writeLine(textBlocks[i]);
            context.printer.writeJsonInColor(chalk.gray, knowledgeBlocks[i]);
        }
    }

    function testHtmlPartsDef(): CommandMetadata {
        return {
            description: "Html to to DocParts",
            args: {
                filePath: arg("File path"),
            },
            options: {
                rootTag: arg("Root tag", "body"),
                buildIndex: argBool("Build doc index", false),
                maxParts: argNum("Max parts to index"),
            },
        };
    }
    commands.kpTestHtmlParts.metadata = testHtmlPartsDef();
    async function testHtmlParts(args: string[]) {
        const namedArgs = parseNamedArguments(args, testHtmlPartsDef());
        const filePath = namedArgs.filePath;
        if (!filePath) {
            return;
        }
        let html = await readAllText(filePath);
        let docParts = cm.docPartsFromHtml(html, false, namedArgs.rootTag);
        for (const part of docParts) {
            context.printer.writeLine("----------------");
            context.printer.writeDocPart(part);
        }
        const maxParts = Math.min(
            docParts.length,
            namedArgs.maxParts ?? Number.MAX_SAFE_INTEGER,
        );
        if (maxParts < docParts.length) {
            docParts = docParts.slice(0, maxParts);
        }
        if (!namedArgs.buildIndex) {
            return;
        }
        context.printer.writeLine(`Indexing ${maxParts} document parts`);
        const docMemory = new cm.DocMemory("", docParts);
        docMemory.settings.conversationSettings.semanticRefIndexSettings.autoExtractKnowledge =
            false;
        const progress = new ProgressBar(context.printer, maxParts);
        const eventHandler = createIndexingEventHandler(
            context.printer,
            progress,
            maxParts,
        );
        const indexingResults = await docMemory.buildIndex(eventHandler);
        context.printer.writeIndexingResults(indexingResults);
        const savePath = sourcePathToMemoryIndexPath(namedArgs.filePath);
        // Save the index
        await docMemory.writeToFile(
            path.dirname(savePath),
            getFileName(savePath),
        );

        context.conversation = docMemory;
    }

    function searchBatchDef(): CommandMetadata {
        return {
            description:
                "Run a batch file of language search queries and save results",
            args: {
                srcPath: argSourceFile(),
            },
            options: {
                destPath: argDestFile(),
            },
        };
    }
    commands.kpTestSearchBatch.metadata = searchBatchDef();
    async function searchBatch(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }
        try {
            beginTestBatch();

            const namedArgs = parseNamedArguments(args, searchBatchDef());
            const destPath =
                namedArgs.destPath ??
                changeFileExt(namedArgs.srcPath, ".json", "_results");
            const results = await kpTest.runSearchBatch(
                context,
                namedArgs.srcPath,
                destPath,
                (srResult, index, total) => {
                    if (srResult.success) {
                        context.printer.writeProgress(index + 1, total);
                        context.printer.writeLine(
                            srResult.data.cmd ?? srResult.data.searchText,
                        );
                    } else {
                        context.printer.writeError(srResult.message);
                    }
                },
            );
            if (!results.success) {
                context.printer.writeError(results.message);
                return;
            }
        } finally {
            endTestBatch();
        }
    }

    function verifySearchBatchDef(): CommandMetadata {
        return {
            description: "Test previously query + saved batch results",
            args: {
                srcPath: argSourceFile(),
            },
            options: {
                verbose: argBool("Verbose error output", false),
            },
        };
    }
    commands.kpTestVerifySearchBatch.metadata = verifySearchBatchDef();
    async function verifySearchBatch(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }
        try {
            beginTestBatch();

            const namedArgs = parseNamedArguments(args, verifySearchBatchDef());
            const srcPath = namedArgs.srcPath;

            const startTimestamp = new Date();
            const results = await kpTest.verifyLangSearchResultsBatch(
                context,
                srcPath,
                (result, index, total) => {
                    context.printer.writeProgress(index + 1, total);
                    if (result.success) {
                        writeSearchScore(result.data, namedArgs.verbose);
                    } else {
                        context.printer.writeError(result.message);
                    }
                },
            );
            if (!results.success) {
                context.printer.writeError(results.message);
                return;
            }
            await writeSearchValidationReport(
                results.data,
                srcPath,
                startTimestamp,
            );
        } finally {
            endTestBatch();
        }
    }

    function answerBatchDef(): CommandMetadata {
        return {
            description: "Run a batch of language queries and save answers",
            args: {
                srcPath: argSourceFile(),
            },
            options: {
                destPath: argDestFile(),
            },
        };
    }
    commands.kpTestAnswerBatch.metadata = answerBatchDef();
    async function answerBatch(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }
        try {
            beginTestBatch();

            const namedArgs = parseNamedArguments(args, answerBatchDef());
            const srcPath = namedArgs.srcPath;
            const destPath =
                namedArgs.destPath ??
                changeFileExt(srcPath, ".json", "_results");
            await kpTest.runAnswerBatch(
                context,
                namedArgs.srcPath,
                destPath,
                (result, index, total) => {
                    context.printer.writeProgress(index + 1, total);
                    if (result.success) {
                        context.printer.writeLine(
                            result.data.cmd ?? result.data.question,
                        );
                        context.printer.writeInColor(
                            chalk.greenBright,
                            result.data.answer,
                        );
                    } else {
                        context.printer.writeError(result.message);
                    }
                },
            );
        } finally {
            endTestBatch();
        }
    }

    function verifyAnswerBatchDef(): CommandMetadata {
        return {
            description: "Verify a batch of language query answers",
            args: {
                srcPath: argSourceFile(),
            },
            options: {
                similarity: argNum(
                    "Similarity: Generated answer must have at least this similarity to baseline",
                    0.9,
                ),
                verbose: argBool("Verbose error output", false),
            },
        };
    }
    commands.kpTestVerifyAnswerBatch.metadata = verifyAnswerBatchDef();
    async function verifyAnswerBatch(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }
        try {
            beginTestBatch();

            const namedArgs = parseNamedArguments(args, verifyAnswerBatchDef());
            const minSimilarity = namedArgs.similarity;
            const srcPath = namedArgs.srcPath;

            const model = openai.createEmbeddingModel();
            const results = await kpTest.verifyQuestionAnswerBatch(
                context,
                srcPath,
                model,
                (result, index, total) => {
                    context.printer.writeProgress(index + 1, total);
                    if (result.success) {
                        writeAnswerScore(
                            result.data,
                            minSimilarity,
                            namedArgs.verbose,
                        );
                    } else {
                        context.printer.writeError(result.message);
                    }
                },
            );
            if (!results.success) {
                context.printer.writeError(results.message);
            }
        } finally {
            endTestBatch();
        }
    }

    function loadTestIndexDef(): CommandMetadata {
        return {
            description: "Load index used by unit tests",
            options: {
                secondaryIndex: argBool("Use secondary indexes", true),
            },
        };
    }
    commands.kpLoadTestIndex.metadata = loadTestIndexDef();
    async function loadTestIndex(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, loadTestIndexDef());
        let samplePath = "../../../../packages/knowPro/test/data    ";
        samplePath = getAbsolutePath(samplePath, import.meta.url);

        const cData = await kp.readConversationDataFromFile(
            samplePath,
            "Episode_53_AdrianTchaikovsky_index",
            1536,
        );
        if (cData) {
            const conversation = await kp.createConversationFromData(
                cData,
                kp.createConversationSettings(),
            );
            if (!namedArgs.secondaryIndex) {
                conversation.secondaryIndexes = undefined;
            }
            context.conversation = conversation;
        }
    }

    async function testMultipleChoice(args: string[]) {
        const namedArgs = parseNamedArguments(
            args,
            kpTest.getAnswerRequestDef(),
        );
        if (!namedArgs.choices) {
            context.printer.writeError("No choices provided");
            return;
        }
        const choices: string[] = namedArgs.choices?.split(";");
        if (!choices || choices.length === 0) {
            context.printer.writeError("No choices provided");
            return;
        }

        const searchResponse = await kpTest.execSearchRequest(
            context,
            namedArgs,
        );
        const searchResults = searchResponse.searchResults;
        if (!searchResults.success) {
            context.printer.writeError(searchResults.message);
            return;
        }
        const getAnswerRequest = parseTypedArguments<kpTest.GetAnswerRequest>(
            args,
            kpTest.getAnswerRequestDef(),
        );
        let response = await kp.generateMultipleChoiceAnswer(
            context.conversation!,
            context.answerGenerator,
            getAnswerRequest.query,
            choices,
            searchResults.data,
        );
        if (!response.success) {
            context.printer.writeError(response.message);
            response = await kp.generateAnswer(
                context.conversation!,
                context.answerGenerator,
                getAnswerRequest.query,
                searchResults.data,
            );
            if (response.success) {
                context.printer.writeAnswer(response.data);
            }
        } else {
            context.printer.writeAnswer(response.data);
        }
    }

    function ensureConversationLoaded(): kp.IConversation | undefined {
        if (context.conversation) {
            return context.conversation;
        }
        context.printer.writeError("No conversation loaded");
        return undefined;
    }

    function testSearchDef(): CommandMetadata {
        const def = searchDef();
        def.options ??= {};
        def.options!.compare = argBool("Compare to V1 mode", false);
        return def;
    }
    commands.kpTestSearch.metadata = testSearchDef();
    async function testSearchScope(args: string[]) {
        const namedArgs = parseNamedArguments(args, testSearchDef());
        const queryTranslator =
            context.conversation! instanceof cm.Memory
                ? context.conversation!.settings.queryTranslator
                : context.queryTranslator;
        const result = namedArgs.compare
            ? await queryTranslator.translate(namedArgs.query)
            : undefined;
        if (result) {
            context.printer.writeTranslation(result);
        }

        context.printer.writeHeading("Scope");
        const resultScope = await queryTranslator.translate2!(namedArgs.query);
        context.printer.writeTranslation(resultScope);
        if ((result === undefined || result.success) && resultScope.success) {
            if (result !== undefined) {
                const error = kpTest.compareSearchQueryScope(
                    result.data,
                    resultScope.data,
                );
                if (error !== undefined) {
                    context.printer.writeError(error);
                }
            }
            if (!ensureConversationLoaded()) {
                return;
            }
            const request = parseTypedArguments<kpTest.SearchRequest>(
                args,
                searchDef(),
            );
            const options: kp.LanguageSearchOptions = {
                ...kpTest.createSearchOptions(request),
                compileOptions: {
                    exactScope: request.exactScope,
                    applyScope: request.applyScope,
                },
            };
            const query = kp.compileSearchQuery2(
                context.conversation!,
                resultScope.data,
                options.compileOptions,
            );

            const results = (
                await kp.runSearchQueries(context.conversation!, query, options)
            ).flat();
            for (let i = 0; i < results.length; ++i) {
                context.printer.writeConversationSearchResult(
                    context.conversation!,
                    results[i],
                    namedArgs.showKnowledge,
                    namedArgs.showMessages,
                    namedArgs.maxToDisplay,
                    namedArgs.distinct,
                );
            }
        }
    }

    function writeSearchScore(
        result: kpTest.Comparison<kpTest.LangSearchResults>,
        verbose: boolean = false,
    ): boolean {
        const error = result.error;
        if (error !== undefined && error.length > 0) {
            context.printer.writeLineInColor(
                chalk.gray,
                result.actual.searchText,
            );
            context.printer.writeInColor(chalk.red, `${result.expected.cmd!}`);
            context.printer.writeInColor(chalk.red, `Error:\n ${error}`);
            if (verbose) {
                context.printer.writeLine("===========");
                context.printer.writeJsonInColor(
                    chalk.red,
                    result.actual.searchQueryExpr,
                );
                context.printer.writeJsonInColor(
                    chalk.red,
                    result.actual.results,
                );
                context.printer.writeJsonInColor(
                    chalk.green,
                    result.expected.searchQueryExpr,
                );
                context.printer.writeJsonInColor(
                    chalk.green,
                    result.expected.results,
                );
                context.printer.writeLine("===========");
            }
            return false;
        } else {
            context.printer.writeInColor(
                chalk.greenBright,
                result.actual.searchText,
            );
            return true;
        }
    }

    async function writeSearchValidationReport(
        results: kpTest.Comparison<kpTest.LangSearchResults>[],
        srcPath: string,
        startDate: Date,
    ) {
        const report = kpTest.createSearchTestReport(results, srcPath, {
            startDate,
            stopDate: new Date(),
        });
        context.printer.writeLine(`${report.errors.length} errors`);
        if (report.errors.length > 0) {
            context.printer.writeList(report.errors.map((e) => e.expected.cmd));
        }
        await context.log.writeTestReport(report, getFileName(srcPath));
    }

    function writeAnswerScore(
        result: kpTest.SimilarityComparison<kpTest.QuestionAnswer>,
        threshold: number,
        verbose: boolean = false,
    ) {
        const isSimilar = result.score >= threshold;
        context.printer.writeInColor(
            isSimilar ? chalk.greenBright : chalk.redBright,
            result.expected.cmd!,
        );
        if (!isSimilar) {
            context.printer.writeError(
                `Similarity ${result.score} / ${threshold}`,
            );
        }
        if (result.score < threshold && verbose) {
            context.printer.writeJsonInColor(chalk.redBright, result.actual);
            context.printer.writeJsonInColor(chalk.green, result.expected);
        }
    }

    function beginTestBatch(): void {
        context.retryNoAnswer = true;
    }

    function endTestBatch(): void {
        context.retryNoAnswer = false;
    }
    return;
}
