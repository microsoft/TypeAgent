// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    argBool,
    argNum,
    CommandHandler,
    CommandMetadata,
    parseNamedArguments,
} from "interactive-app";
import { KnowproContext } from "./knowproMemory.js";
import { argDestFile, argSourceFile } from "../common.js";
import * as kp from "knowpro";
import * as kpTest from "knowpro-test";
import {
    changeFileExt,
    getAbsolutePath,
    readAllText,
    simplifyHtml,
    simplifyText,
} from "typeagent";
import chalk from "chalk";
import { openai } from "aiclient";

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

    async function testHtml(args: string[]) {
        const html = await readAllText(args[0]);
        const simpleHtml = simplifyHtml(html);
        context.printer.writeLine(simpleHtml);
    }
    async function testHtmlText(args: string[]) {
        const html = await readAllText(args[0]);
        const text = simplifyText(html);
        context.printer.writeLine(text);
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
                    context.printer.writeLine(srResult.data.searchText);
                } else {
                    context.printer.writeError(srResult.message);
                }
            },
        );
        if (!results.success) {
            context.printer.writeError(results.message);
        }
    }

    function verifySearchBatchDef(): CommandMetadata {
        return {
            description: "Test previously query + saved batch results",
            args: {
                srcPath: argSourceFile(),
            },
            options: {
                startAt: argNum("Start at this query", 0),
                count: argNum("Number to run"),
                verbose: argBool("Verbose error output", false),
            },
        };
    }
    commands.kpTestVerifySearchBatch.metadata = verifySearchBatchDef();
    async function verifySearchBatch(args: string[]) {
        if (!ensureConversationLoaded()) {
            return;
        }

        const namedArgs = parseNamedArguments(args, verifySearchBatchDef());
        const srcPath = namedArgs.srcPath;
        let errorCount = 0;
        const results = await kpTest.verifyLangSearchResultsBatch(
            context,
            srcPath,
            (result, index, total) => {
                context.printer.writeProgress(index + 1, total);
                if (result.success) {
                    if (!writeSearchScore(result.data, namedArgs.verbose)) {
                        errorCount++;
                    }
                } else {
                    context.printer.writeError(result.message);
                }
            },
        );
        if (!results.success) {
            context.printer.writeError(results.message);
        }
        if (errorCount > 0) {
            context.printer.writeLine(`${errorCount} errors`);
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
        const namedArgs = parseNamedArguments(args, answerBatchDef());
        const srcPath = namedArgs.srcPath;
        const destPath =
            namedArgs.destPath ?? changeFileExt(srcPath, ".json", "_results");
        await kpTest.runAnswerBatch(
            context,
            namedArgs.srcPath,
            destPath,
            (result, index, total) => {
                context.printer.writeProgress(index + 1, total);
                if (result.success) {
                    context.printer.writeLine(result.data.question);
                    context.printer.writeInColor(
                        chalk.greenBright,
                        result.data.answer,
                    );
                } else {
                    context.printer.writeError(result.message);
                }
            },
        );
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

    function ensureConversationLoaded(): kp.IConversation | undefined {
        if (context.conversation) {
            return context.conversation;
        }
        context.printer.writeError("No conversation loaded");
        return undefined;
    }

    function writeSearchScore(
        result: kpTest.Comparison<kpTest.LangSearchResults>,
        verbose: boolean = false,
    ): boolean {
        const error = result.error;
        if (error !== undefined && error.length > 0) {
            context.printer.writeInColor(
                chalk.redBright,
                `[${error}]: ${result.expected.cmd!}`,
            );
            context.printer.writeInColor(chalk.red, `Error: ${error}`);
            if (verbose) {
                context.printer.writeJsonInColor(
                    chalk.red,
                    result.actual.results,
                );
                context.printer.writeJsonInColor(
                    chalk.green,
                    result.expected.results,
                );
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

    return;
}
