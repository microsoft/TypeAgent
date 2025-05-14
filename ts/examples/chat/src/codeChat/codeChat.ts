// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ===============================================
 * Early experiments with code-processor package
 * ===============================================
 */

import { asyncArray, removeDir } from "typeagent";
import {
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    NamedArgs,
    addStandardHandlers,
    parseNamedArguments,
    runConsole,
} from "interactive-app";
import {
    BreakPointSuggestions,
    CodeAnswer,
    createCodeReviewer,
    codeToLines,
    tsCode,
    createSemanticCodeIndex,
    StoredCodeBlock,
} from "code-processor";
import { CodePrinter } from "./codePrinter.js";
import path from "path";
import { openai } from "aiclient";
import chalk from "chalk";
import { pathToFileURL } from "url";
import {
    getSourcePath,
    loadCodeChunks,
    loadTypescriptCode,
    sampleFiles,
} from "./common.js";
import { createCommandTransformer } from "./commandTransformer.js";

export async function runCodeChat(): Promise<void> {
    const model = openai.createChatModelDefault("codeChat");
    const codeReviewer = createCodeReviewer(model);
    // For answer/code indexing examples
    const folderPath = "/data/code";
    const vectorModel = openai.createEmbeddingModel();
    const codeIndexPath = path.join(folderPath, "index");
    let codeIndex = await ensureCodeIndex();
    let printer: CodePrinter;

    const handlers: Record<string, CommandHandler> = {
        codeReview,
        codeDebug,
        codeBreakpoints,
        codeAnswer,
        codeDocument,
        indexCode,
        findCode,
        clearCodeIndex,
        regex,
        cwd,
    };
    addStandardHandlers(handlers);

    function onStart(io: InteractiveIo): void {
        printer = new CodePrinter(io);
    }

    async function cwd() {
        printer.writeLine(process.cwd());
    }

    function reviewDef(): CommandMetadata {
        return {
            description: "Review the given Typescript file",
            options: {
                sourceFile: {
                    description: "Path to source file",
                    type: "string",
                    defaultValue: sampleFiles.testCode,
                },
                verbose: {
                    description: "Verbose output",
                    type: "boolean",
                    defaultValue: false,
                },
            },
        };
    }
    handlers.codeReview.metadata = reviewDef();
    async function codeReview(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, reviewDef());

        printer.writeLine(`Source file:\n${namedArgs.sourceFile}`);

        // Load file to review
        const code = await loadTypescriptCode(namedArgs.sourceFile);
        if (namedArgs.verbose) {
            printer.writeCodeLines(code.sourceText);
        }
        // Run a code review
        const review = await codeReviewer.review(code.sourceText);
        printer.writeFullCodeReview(code.sourceText, review);
    }

    function debugDef(): CommandMetadata {
        return {
            description: "Debug the given Typescript file",
            options: {
                sourceFile: {
                    description: "Path to source file",
                    type: "path",
                    defaultValue: sampleFiles.snippet,
                },
                moduleDir: {
                    description: "Path to modules dir",
                    type: "path",
                },
                bug: {
                    description: "A description of the observed bug",
                    defaultValue:
                        "I am observing assertion failures in the code below. Review the code below and explain why",
                },
                verbose: {
                    description: "Verbose output",
                    type: "boolean",
                    defaultValue: false,
                },
            },
        };
    }
    handlers.codeDebug.metadata = debugDef();
    async function codeDebug(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, debugDef());

        printer.writeLine(`Source file:\n${namedArgs.sourceFile}`);
        printer.writeLine(`Bug Description:\n${namedArgs.bug}\n`);

        const code = await loadTypescriptCode(
            namedArgs.sourceFile,
            namedArgs.moduleDir,
        );
        if (namedArgs.verbose) {
            printer.writeCodeLines(code.sourceText);
        }
        const review = await codeReviewer.debug(
            namedArgs.bug,
            code.sourceText,
            code.modules,
        );
        printer.writeFullCodeReview(code.sourceText, review, false);
    }

    function breakpointDef(): CommandMetadata {
        return {
            description:
                "Suggest where to set breakpoints in a Typescript file",
            options: {
                sourceFile: {
                    description: "Path to source file",
                    type: "path",
                    defaultValue: sampleFiles.snippet,
                },
                moduleDir: {
                    description: "Path to modules dir",
                    type: "path",
                },
                bug: {
                    description: "A description of the observed bug",
                    defaultValue:
                        "I am observing assertion failures in the code below.",
                },
                verbose: {
                    description: "Verbose output",
                    type: "boolean",
                    defaultValue: false,
                },
            },
        };
    }
    handlers.codeBreakpoints.metadata = breakpointDef();
    async function codeBreakpoints(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, breakpointDef());
        const code = await loadTypescriptCode(
            namedArgs.sourceFile,
            namedArgs.moduleDir,
        );

        printer.writeLine(`Source file:\n${namedArgs.sourceFile}`);
        printer.writeLine(`Bug Description:\n${namedArgs.bug}\n`);
        const suggestions = await codeReviewer.breakpoints(
            namedArgs.bug,
            code.sourceText,
            code.modules,
        );
        if (namedArgs.verbose) {
            printer.writeCodeLines(code.sourceText);
        }
        printBreakpoints(code.sourceText, suggestions);
    }

    function answerDef(): CommandMetadata {
        return {
            description: "Answer questions about code",
            options: {
                question: { description: "Question to ask" },
                sourceFile: {
                    description: "Path to source file",
                    type: "path",
                    defaultValue: sampleFiles.testCode,
                },
                verbose: {
                    type: "boolean",
                    defaultValue: false,
                },
            },
        };
    }
    handlers.codeAnswer.metadata = answerDef();
    async function codeAnswer(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, answerDef());
        const question =
            namedArgs.question ??
            "I am looking for an example of how to raise a number to a power";
        printer.writeLine(`Source file:\n${namedArgs.sourceFile}`);
        printer.writeLine(`Question:\n${question}\n`);

        const functions = await loadCodeChunks(namedArgs.sourceFile);
        await asyncArray.mapAsync(
            functions,
            2,
            (funcCode, index) => codeReviewer.answer(question, funcCode),
            (funcCode, index, answers) => {
                if (
                    answers.answerStatus !== "NotAnswered" ||
                    namedArgs.verbose
                ) {
                    const lines = codeToLines(funcCode);
                    printAnswers(lines, answers);
                    printer.writeLine();
                } else {
                    printer.writeLine(".");
                }
                // Only continue searching if no answers found
                return answers.answerStatus !== "Answered";
            },
        );
    }

    function documentDef(): CommandMetadata {
        return {
            description: "Document given code",
            options: {
                sourceFile: {
                    description: "Path to source file",
                    type: "path",
                    defaultValue: sampleFiles.testCode,
                },
            },
        };
    }
    handlers.codeDocument.metadata = documentDef();
    async function codeDocument(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, documentDef());
        const functions = await loadCodeChunks(namedArgs.sourceFile);
        await asyncArray.mapAsync(
            functions,
            2,
            (code, index) =>
                codeReviewer.document({ code, language: "typescript" }),
            (code, index, docs) => {
                const lines = codeToLines(code);
                printer.writeAllDocs(lines, docs);
                printer.writeLine();
            },
        );
    }

    function indexDef(): CommandMetadata {
        return {
            description: "Index given code",
            args: {
                sourceFile: {
                    description: "Path to source file",
                    type: "path",
                },
            },
            options: {
                module: {
                    description: "Module name",
                },
                verbose: {
                    type: "boolean",
                    defaultValue: false,
                },
            },
        };
    }
    handlers.indexCode.metadata = indexDef();
    async function indexCode(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, indexDef());
        const fullPath = getSourcePath(namedArgs.sourceFile);
        const moduleName =
            namedArgs.module ?? path.basename(fullPath, path.extname(fullPath));
        const sourceFile = await tsCode.loadSourceFile(fullPath);
        const statements = tsCode.getTopLevelStatements(sourceFile);
        await asyncArray.forEachAsync(
            statements,
            4,
            async (statement, index) => {
                let name = tsCode.getStatementName(statement);
                if (name) {
                    name = `${moduleName}.${name}`;
                    let code = tsCode.getTextOfStatement(sourceFile, statement);
                    const docs = await codeIndex.put(
                        { code, language: "typescript" },
                        name,
                        fullPath,
                    );
                    let text = "";
                    for (const comment in docs.comments) {
                        if (text) {
                            text += "\n";
                        }
                        text += `${comment}`;
                    }
                    if (text) {
                        if (namedArgs.verbose) {
                            printer.writeTitle(name);
                            printer.writeLine(text);
                        } else {
                            printer.writeBullet(name);
                        }
                    }
                }
            },
        );
    }

    function findCodeDef(): CommandMetadata {
        return {
            description: "Query the code index",
            args: {
                query: {
                    description: "Query to run",
                },
            },
            options: {
                maxMatches: {
                    description: "Max number of matches",
                    type: "number",
                    defaultValue: 1,
                },
            },
        };
    }
    handlers.findCode.metadata = findCodeDef();
    async function findCode(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, findCodeDef());
        const matches = await codeIndex.find(
            namedArgs.query,
            namedArgs.maxMatches,
        );
        for (const match of matches) {
            const name = match.item;
            printer.writeInColor(chalk.green, name);
            const codeBlock = await codeIndex.get(name);
            printCodeBlock(codeBlock);
            printer.writeLine();
        }
    }

    handlers.clearCodeIndex.metadata = "Clear the code index";
    async function clearCodeIndex(): Promise<void> {
        codeIndex = await ensureCodeIndex(true);
    }

    handlers.regex.metadata =
        "Generate a regular expression from the given requirements.";
    async function regex(args: string[], io: InteractiveIo): Promise<void> {
        if (args.length > 0) {
            const prompt = `Return a Typescript regular expression for the following:\n ${args.join(" ")}`;
            const result = await codeReviewer.model.complete(prompt);
            if (result.success) {
                io.writer.writeLine(result.data);
            } else {
                io.writer.writeLine(result.message);
            }
        } else {
            io.writer.writeLine("Usage: @regex <requirements>");
        }
    }

    async function ensureCodeIndex(createNew: boolean = false) {
        if (createNew) {
            await removeDir(codeIndexPath);
        }
        return await createSemanticCodeIndex(
            codeIndexPath,
            codeReviewer,
            vectorModel,
        );
    }

    function printBreakpoints(
        lines: string[],
        suggestions: BreakPointSuggestions,
    ): void {
        printer.writeHeading("SUGGESTED BREAKPOINTS");
        for (let i = 0; i < lines.length; ++i) {
            printer.writeBreakpoints(lines[i], i + 1, suggestions);
            printer.writeCodeLine(i + 1, lines[i]);
        }
    }

    function printAnswers(lines: string[], answer: CodeAnswer): void {
        printer.writeTitle(answer.answerStatus);
        if (answer.answerStatus === "NotAnswered") {
            printer.writeCodeLines(lines);
            return;
        }
        for (let i = 0; i < lines.length; ++i) {
            printer.writeAnswer(lines[i], i + 1, answer);
            printer.writeCodeLine(i + 1, lines[i]);
        }
    }

    function printCodeBlock(codeBlock: StoredCodeBlock | undefined): void {
        if (codeBlock) {
            const code = codeBlock.code.code;
            if (typeof code === "string") {
                printer.writeLine(code);
            } else {
                printer.writeCodeLines(code);
            }
            if (codeBlock.sourcePath) {
                printer.writeInColor(
                    chalk.gray,
                    pathToFileURL(codeBlock.sourcePath).toString(),
                );
            }
        }
    }

    const commandTransformer = createCommandTransformer(model, handlers);

    // Handles input not starting with @,
    // Transforming it into a regular @ command (which it then calls)
    // or printing an error message.
    async function inputHandler(
        line: string,
        io: InteractiveIo,
    ): Promise<void> {
        // Pass it to TypeChat to transform and dispatch as an @ command
        const error = await commandTransformer.transformAndDispatch(line, io);
        if (error) {
            io.writer.writeLine("[Error:] " + error + "; try @help");
            return;
        }
    }

    await runConsole({
        onStart,
        inputHandler,
        handlers,
    });
}
