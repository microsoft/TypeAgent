// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import * as kp from "knowpro";
import * as knowLib from "knowledge-processor";
import {
    arg,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    parseNamedArguments,
    NamedArgs,
} from "interactive-app";
import { ensureDir, getFileName } from "typeagent";

import { ChatModel, TextEmbeddingModel, openai } from "aiclient";
import { SRAG_MEM_DIR } from "../common.js";
import fs from "fs";
import { AppPrinter } from "../printer.js";
import { importPdf } from "./importPdf.js";
import path from "path";
import * as pi from "./pdfDocument.js";
import { argDestFile, argSourceFile } from "../common.js";

export type Models = {
    chatModel: ChatModel;
    answerModel: ChatModel;
    embeddingModel: TextEmbeddingModel;
    embeddingModelSmall?: TextEmbeddingModel | undefined;
};

export type ChatContext = {
    io: InteractiveIo;
    storePath: string;
    statsPath: string;
    models: Models;
    maxCharsPerChunk: number;
    stats?: knowLib.IndexingStats | undefined;
    topicWindowSize: number;
    searchConcurrency: number;
    minScore: number;
    entityTopK: number;
    actionTopK: number;
    conversationName: string;
    conversationSettings: knowLib.conversation.ConversationSettings;
};

export function createModels(): Models {
    const chatModelSettings = openai.apiSettingsFromEnv(openai.ModelType.Chat);
    chatModelSettings.retryPauseMs = 10000;
    const embeddingModelSettings = openai.apiSettingsFromEnv(
        openai.ModelType.Embedding,
    );
    embeddingModelSettings.retryPauseMs = 25 * 1000;

    const models: Models = {
        chatModel: openai.createJsonChatModel(chatModelSettings, [
            "doc-memory",
        ]),
        answerModel: openai.createChatModel(),
        embeddingModel: knowLib.createEmbeddingCache(
            openai.createEmbeddingModel(embeddingModelSettings),
            1024,
        ),
        /*
        embeddingModelSmall: knowLib.createEmbeddingCache(
            openai.createEmbeddingModel("3_SMALL", 1536),
            256,
        ),
        */
    };
    models.chatModel.completionSettings.seed = 123;
    models.answerModel.completionSettings.seed = 123;
    return models;
}

export type KnowProContext = {
    knowledgeModel: ChatModel;
    knowledgeActions: knowLib.conversation.KnowledgeActionTranslator;
    basePath: string;
    printer: AppPrinter;
    pdfIndex: pi.PdfKnowproIndex | undefined;
    queryTranslator: kp.SearchQueryTranslator;
    answerGenerator: kp.AnswerGenerator;
};

export async function createKnowproCommands(
    chatContext: ChatContext,
    commands: Record<string, CommandHandler>,
): Promise<void> {
    const knowledgeModel = chatContext.models.chatModel;
    const context: KnowProContext = {
        knowledgeModel,
        knowledgeActions:
            knowLib.conversation.createKnowledgeActionTranslator(
                knowledgeModel,
            ),
        pdfIndex: undefined,
        queryTranslator: kp.createSearchQueryTranslator(knowledgeModel),
        answerGenerator: new kp.AnswerGenerator(
            kp.createAnswerGeneratorSettings(knowledgeModel),
        ),
        basePath: `${SRAG_MEM_DIR}`,
        printer: new AppPrinter(),
    };

    await ensureDir(context.basePath);
    commands.kpPdfImport = pdfImport;
    commands.kpPdfSave = pdfSave;
    commands.kpPdfLoad = pdfLoad;
    //commands.kpPdfBuildIndex = pdfBuildIndex;

    function pdfImportDef(): CommandMetadata {
        return {
            description: "Import a single or multiple PDF files.",
            options: {
                fileName: {
                    description:
                        "File to import (or multiple files separated by commas)",
                    type: "string",
                },
                files: {
                    description: "File containing the list of files to import",
                    type: "string",
                },
                verbose: {
                    description: "More verbose output",
                    type: "boolean",
                    defaultValue: true,
                },
                chunkPdfs: {
                    description: "Chunk the PDFs",
                    type: "boolean",
                    defaultValue: true,
                },
                maxPages: {
                    description:
                        "Maximum number of pages to process, default is all pages.",
                    type: "integer",
                    defaultValue: -1,
                },
            },
        };
    }
    commands.kpPdfImport.metadata = pdfImportDef();
    async function pdfImport(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, pdfImportDef());
        const files = namedArgs.fileName
            ? (namedArgs.fileName as string).trim().split(",")
            : namedArgs.files
              ? fs
                    .readFileSync(namedArgs.files as string, "utf-8")
                    .split("\n")
                    .map((line) => line.trim())
                    .filter((line) => line.length > 0 && line[0] !== "#")
              : [];
        if (!files.length) {
            context.printer.writeError(
                "[No files to import (use --? for help)]",
            );
            return;
        }

        const chunkPdfs =
            namedArgs.chunkPdfs === undefined
                ? true
                : namedArgs.chunkPdfs?.toString().toLowerCase() === "true";

        const maxPagesToProcess =
            namedArgs.maxPages === undefined
                ? -1
                : parseInt(namedArgs.maxPages as string);
        if (isNaN(maxPagesToProcess)) {
            context.printer.writeError("[Invalid maxPages value]");
            return;
        }

        // import files in to srag index
        context.pdfIndex = await importPdf(
            context.printer,
            files[0],
            undefined,
            namedArgs.verbose,
            chunkPdfs,
            maxPagesToProcess,
        );
        context.printer.writeLine("Imported PDF files ...");
    }

    function pdfSaveDef(): CommandMetadata {
        return {
            description: "Save the pdf srag index",
            args: {
                filePath: argDestFile(),
            },
        };
    }

    commands.kpImagesSave.metadata = pdfSaveDef();
    async function pdfSave(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, pdfSaveDef());
        if (!context.pdfIndex) {
            context.printer.writeError("No image collection loaded");
            return;
        }
        context.printer.writeLine("Saving index");
        context.printer.writeLine(namedArgs.filePath);
        if (context.pdfIndex) {
            const dirName = path.dirname(namedArgs.filePath);
            await ensureDir(dirName);
            await context.pdfIndex.writeToFile(
                dirName,
                getFileName(namedArgs.filePath),
            );
        }
    }

    function pdfLoadDef(): CommandMetadata {
        return {
            description: "Load pdf srag index",
            options: {
                filePath: argSourceFile(),
                name: arg("Pdf SRAG Index Name"),
            },
        };
    }

    commands.kpImagesLoad.metadata = pdfLoadDef();
    async function pdfLoad(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, pdfLoadDef());
        let imagesFilePath = namedArgs.filePath;
        imagesFilePath ??= namedArgs.name
            ? indexFilePathFromName(namedArgs.name)
            : undefined;
        if (!imagesFilePath) {
            context.printer.writeError("No filepath or name provided");
            return;
        }
        context.pdfIndex = await pi.PdfKnowproIndex.readFromFile(
            path.dirname(imagesFilePath),
            getFileName(imagesFilePath),
        );
        if (!context.pdfIndex) {
            context.printer.writeLine("Pdf SRAG Index not found");
            return;
        }
        //context.conversation = context.pdfIndex;
    }

    const IndexFileSuffix = "_index.json";
    function indexFilePathFromName(indexName: string): string {
        return path.join(context.basePath, indexName + IndexFileSuffix);
    }
}
