// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// import ts from "typescript";
import { getAbsolutePath, readAllLines, asyncArray } from "typeagent";
import {
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    addStandardHandlers,
    displayHelp,
    getArg,
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
} from "code-processor";
import { CodePrinter } from "./codePrinter.js";
import path from "path";
import { openai } from "aiclient";
import ts from "typescript";

export async function runCodeChat(): Promise<void> {
    const codeReviewer = createCodeReviewer();
    const sampleFiles = {
        snippet: "../../src/codeChat/testCode/snippet.ts",
    };
    const sampleModuleDir = "../../dist/codeChat/testCode";
    // For answer/code indexing examples
    const folderPath = "/data/code";
    const vectorModel = openai.createEmbeddingModel();
    const codeIndex = await createSemanticCodeIndex(
        path.join(folderPath, "index"),
        codeReviewer,
        vectorModel,
    );
    let printer: CodePrinter;

    const handlers: Record<string, CommandHandler> = {
        help,
        "--?": help,
        review,
        debug,
        breakpoints,
        answer,
        document,
        indexCode,
        findCode,
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
        printer.writeLine("Code Diagnostics with TypeChat");
    }

    async function help(args: string[], io: InteractiveIo): Promise<void> {
        displayHelp(args, handlers, io);
    }

    async function review(args: string[]): Promise<void> {
        const sourceFile = getArg(
            args,
            0,
            "../../src/codeChat/testCode/testCode.ts",
        );
        const sourcePath = getAbsolutePath(sourceFile, import.meta.url);
        const sourceText = await readAllLines(sourcePath);
        const review = await codeReviewer.review(sourceText);
        printCodeReview(sourceText, review);
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
        const code = await loadTypescriptCode(
            namedArgs.sourceFile,
            namedArgs.moduleDir,
        );
        printer.writeLine(`Source file:\n${namedArgs.sourceFile}`);
        printer.writeLine(`Bug Description:\n${namedArgs.bug}\n`);
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

    async function breakpoints(args: string[]): Promise<void> {
        const observation =
            "I am observing assertion failures in the code below. Review the code below and explain why";
        const sourceFile = sampleFiles.snippet;
        const sourcePath = getAbsolutePath(sourceFile, import.meta.url);
        const sourceText = await readAllLines(sourcePath);
        let sourceCode = await tsCode.loadSourceFile(sourcePath);

        const moduleDir = getAbsolutePath(
            "../../dist/codeChat/testCode",
            import.meta.url,
        );
        const modules = await tsCode.loadImports(sourceCode, moduleDir);
        const suggestions = await codeReviewer.breakpoints(
            observation,
            sourceText,
            modules,
        );
        printer.writeLine(observation);
        printBreakpoints(sourceText, suggestions);
    }

    function answerDef(): CommandMetadata {
        return {
            description: "Answer questions about code",
            options: {
                question: { description: "Question to ask" },
                sourcePath: {
                    description: "Path to source file",
                    type: "path",
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
        printer.writeLine(question);

        const functions = await loadCodeChunks(namedArgs.sourcePath);
        await asyncArray.mapAsync(
            functions,
            2,
            (funcCode, index) => codeReviewer.answer(question, funcCode),
            (funcCode, index, answers) => {
                const lines = codeToLines(funcCode);
                printAnswers(lines, answers);
                printer.writeLine();
                // Only continue searching if no answers found
                return answers.answerStatus !== "Answered";
            },
        );
    }

    function documentDef(): CommandMetadata {
        return {
            description: "Document given code",
            options: {
                sourcePath: {
                    description: "Path to source file",
                    type: "path",
                },
            },
        };
    }
    handlers.document.metadata = documentDef();
    async function document(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, documentDef());
        const functions = await loadCodeChunks(namedArgs.sourcePath);
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
            options: {
                sourcePath: {
                    description: "Path to source file",
                    type: "path",
                },
            },
        };
    }
    handlers.indexCode.metadata = indexDef();
    async function indexCode(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, indexDef());
        const fullPath = getSourcePath(namedArgs.sourcePath);
        const sourceFile = await tsCode.loadSourceFile(fullPath);
        const statements = tsCode.getTopLevelStatements(sourceFile);
        await asyncArray.forEachAsync(
            statements,
            4,
            async (statement, index) => {
                let name = tsCode.getStatementName(statement);
                if (name) {
                    let code = tsCode.getTextOfStatement(sourceFile, statement);
                    const text = await codeIndex.put(
                        { code, language: "typescript" },
                        name,
                    );
                    if (text) {
                        printer.writeTitle(name);
                        printer.writeLine(text);
                    }
                }
            },
        );
    }

    async function findCode(args: string[]): Promise<void> {
        const query = getArg(args, 0);
        const matches = await codeIndex.find(query, 5);
        for (const match of matches) {
            console.log(match.item);
        }
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
        sourcePath ??= "../../src/codeChat/testCode/testCode.ts";
        return getAbsolutePath(sourcePath, import.meta.url);
    }

    function loadCodeChunks(
        sourcePath?: string,
        chunkSize: number = 2048,
    ): Promise<string[]> {
        const fullPath = getSourcePath(sourcePath);
        return tsCode.loadChunksFromFile(fullPath, chunkSize);
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
        const sourceText = await readAllLines(sourcePath);
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
