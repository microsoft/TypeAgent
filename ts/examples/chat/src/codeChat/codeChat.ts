// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// import ts from "typescript";
import {
    getAbsolutePath,
    readAllLines,
    asyncArray,
    removeDir,
} from "typeagent";
import {
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    addStandardHandlers,
    parseNamedArguments,
    runConsole,
} from "interactive-app";
import {
    CodeReview,
    BreakPointSuggestions,
    CodeAnswer,
    createCodeReviewer,
    codeToLines,
    tsCode,
    CodeDocumentation,
    createSemanticCodeIndex,
    Module,
    StoredCodeBlock,
} from "code-processor";
import { CodePrinter } from "./codePrinter.js";
import path from "path";
import { openai } from "aiclient";
import ts from "typescript";
import chalk from "chalk";
import { pathToFileURL } from "url";

export async function runCodeChat(): Promise<void> {
    const codeReviewer = createCodeReviewer();
    const sampleFiles = {
        snippet: "../../src/codeChat/testCode/snippet.ts",
        testCode: "../../src/codeChat/testCode/testCode.ts",
    };
    const sampleModuleDir = "../../dist/codeChat/testCode";
    // For answer/code indexing examples
    const folderPath = "/data/code";
    const vectorModel = openai.createEmbeddingModel();
    const codeIndexPath = path.join(folderPath, "index");
    let codeIndex = await ensureCodeIndex();
    let printer: CodePrinter;

    const handlers: Record<string, CommandHandler> = {
        review,
        debug,
        breakpoints,
        answer,
        document,
        indexCode,
        findCode,
        clearCodeIndex,
        regex,
    };
    addStandardHandlers(handlers);
    await runConsole({
        onStart,
        inputHandler,
        handlers,
    });

    async function inputHandler(
        line: string,
        io: InteractiveIo,
    ): Promise<void> {}

    function onStart(io: InteractiveIo): void {
        printer = new CodePrinter(io);
        printer.writeLine("\nCode Diagnostics with TypeChat");
    }

    function reviewDef(): CommandMetadata {
        return {
            description: "Review the given Typescript file",
            options: {
                sourceFile: {
                    description: "Path to source file",
                    type: "path",
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
    handlers.review.metadata = reviewDef();
    async function review(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, reviewDef());

        printer.writeLine(`Source file:\n${namedArgs.sourceFile}`);

        // Load file to review
        const code = await loadTypescriptCode(namedArgs.sourceFile);
        if (namedArgs.verbose) {
            printer.writeCodeLines(code.sourceText);
        }
        // Run a code review
        const review = await codeReviewer.review(code.sourceText);
        printCodeReview(code.sourceText, review);
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
    handlers.debug.metadata = debugDef();
    async function debug(args: string[]): Promise<void> {
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
        printCodeReview(code.sourceText, review);
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
    handlers.breakpoints.metadata = breakpointDef();
    async function breakpoints(args: string[]): Promise<void> {
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
    handlers.answer.metadata = answerDef();
    async function answer(args: string[]): Promise<void> {
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
    handlers.document.metadata = documentDef();
    async function document(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, documentDef());
        const functions = await loadCodeChunks(namedArgs.sourceFile);
        await asyncArray.mapAsync(
            functions,
            2,
            (code, index) =>
                codeReviewer.document({ code, language: "typescript" }),
            (code, index, docs) => {
                const lines = codeToLines(code);
                printDocs(lines, docs);
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
    async function indexCode(args: string[]): Promise<void> {
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
                    const text = await codeIndex.put(
                        { code, language: "typescript" },
                        name,
                        fullPath,
                    );
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
    async function findCode(args: string[]): Promise<void> {
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
    async function clearCodeIndex(args: string[]): Promise<void> {
        codeIndex = await ensureCodeIndex(true);
    }

    handlers.regex.metadata =
        "Generate a regular expression from the given requirements.";
    async function regex(args: string[], io: InteractiveIo): Promise<void> {
        if (args.length > 0) {
            const prompt = `Return a Typescript regular expression for the following:\n ${args[0]}`;
            const result = await codeReviewer.model.complete(prompt);
            if (result.success) {
                io.writer.writeLine(result.data);
            } else {
                io.writer.writeLine(result.message);
            }
        }
    }

    function getSourcePath(sourcePath?: string): string {
        sourcePath ??= sampleFiles.testCode;
        return getAbsolutePath(sourcePath, import.meta.url);
    }

    function loadCodeChunks(
        sourcePath?: string,
        chunkSize: number = 2048,
    ): Promise<string[]> {
        const fullPath = getSourcePath(sourcePath);
        return tsCode.loadChunksFromFile(fullPath, chunkSize);
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

    function printCodeReview(lines: string[], review: CodeReview): void {
        printer.writeHeading("\nCODE REVIEW\n");
        for (let i = 0; i < lines.length; ++i) {
            printer.writeCodeReview(lines[i], i + 1, review);
            printer.writeCodeLine(i + 1, lines[i]);
        }
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

    function printDocs(lines: string[], docs: CodeDocumentation): void {
        for (let i = 0; i < lines.length; ++i) {
            printer.writeDocs(lines[i], i + 1, docs);
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

    function isSampleFile(sourceFile: string): boolean {
        sourceFile = sourceFile.toLowerCase();
        for (const value of Object.values(sampleFiles)) {
            if (value.toLowerCase() === sourceFile) {
                return true;
            }
        }
        return false;
    }

    type TypeScriptCode = {
        sourcePath: string;
        sourceText: string[];
        sourceCode: ts.SourceFile;
        modules: Module[] | undefined;
    };

    async function loadTypescriptCode(
        sourceFile: string,
        moduleDir?: string | undefined,
    ): Promise<TypeScriptCode> {
        const sourcePath = getAbsolutePath(sourceFile, import.meta.url);
        const sourceText = await readAllLines(sourcePath); // Load lines of code
        const sourceCode = await tsCode.loadSourceFile(sourcePath);
        if (!moduleDir && isSampleFile(sourceFile)) {
            moduleDir = sampleModuleDir;
        }
        let modules = moduleDir
            ? await tsCode.loadImports(
                  sourceCode,
                  getAbsolutePath(moduleDir, import.meta.url),
              )
            : undefined;

        return {
            sourcePath,
            sourceText,
            sourceCode,
            modules,
        };
    }
}
