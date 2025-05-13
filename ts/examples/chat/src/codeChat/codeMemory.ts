// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * ===============================================
 * Early experiments with code-processor package
 * ===============================================
 */

import { openai } from "aiclient";
import {
    CodeBlockName,
    codeBlockNameFromFilePath,
    codeBlockNameToString,
    CodeReviewIndex,
    codeToLines,
    createCodeGenerator,
    createCodeReviewer,
    createDeveloperMemory,
    ExtractedCodeReview,
    GeneratedCode,
    LineReview,
    tsCode,
} from "code-processor";
import { CodePrinter } from "./codePrinter.js";
import {
    addStandardHandlers,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    NamedArgs,
    parseNamedArguments,
    runConsole,
} from "interactive-app";
import {
    argConcurrency,
    argCount,
    argDestFile,
    argMaxMatches,
    argMinScore,
    argQuery,
    argSave,
    argSourceFile,
    argVerbose,
    createTypescriptBlock,
    getSourcePath,
    loadCodeChunks,
    loadTypescriptCode,
    TypeScriptCode,
} from "./common.js";
import { asyncArray, removeDir, writeAllLines } from "typeagent";
import ts from "typescript";
import chalk from "chalk";
import { createCommandTransformer } from "./commandTransformer.js";

export async function runCodeMemoryCommands(): Promise<void> {
    const model = openai.createChatModelDefault("codeMemory");
    const memoryFolderPath = "/data/code/memory";
    const codeReviewer = createCodeReviewer(model);
    const codeGenerator = createCodeGenerator(model);
    let developerMemory = await createMemory();
    let printer: CodePrinter;

    const handlers: Record<string, CommandHandler> = {
        clearMemory,
        codeReview,
        codeGen,
        codeDocument,
        codeImport,
        codeSearch,
        bugs,
        comments,
        cwd,
        cd,
    };
    addStandardHandlers(handlers);

    handlers.clearMemory.metadata = "Clear memory";
    async function clearMemory(): Promise<void> {
        await removeDir(memoryFolderPath);
        developerMemory = await createMemory();
    }

    function codeReviewDef(): CommandMetadata {
        return {
            description: "Review the given Typescript file",
            options: {
                sourceFile: argSourceFile(),
                verbose: argVerbose(),
                save: argSave(true),
            },
        };
    }
    handlers.codeReview.metadata = codeReviewDef();
    async function codeReview(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, codeReviewDef());
        const sourceFilePath = getSourcePath(namedArgs.sourceFile);
        const codeName = codeBlockNameFromFilePath(sourceFilePath);
        printer.writeLine(codeBlockNameToString(codeName));
        printer.writeLine(`Source file:\n${sourceFilePath}`);

        // Load file to review
        const code = await loadTypescriptCode(sourceFilePath);
        if (namedArgs.verbose) {
            printer.writeCodeLines(code.sourceText);
        }
        // Run a code review
        const review = await codeReviewer.review(code.sourceText);
        printer.writeFullCodeReview(code.sourceText, review);
        if (!namedArgs.save) {
            return;
        }

        // And save it
        printer.writeLine("Saving memory...");
        const codeId = await importCode(code);
        await developerMemory.addReview(codeId, review);
    }

    function codeDocumentDef(): CommandMetadata {
        return {
            description: "Document given code",
            options: {
                sourceFile: argSourceFile(),
                concurrency: argConcurrency(2),
            },
        };
    }
    handlers.codeDocument.metadata = codeDocumentDef();
    async function codeDocument(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, codeDocumentDef());
        const sourceFilePath = getSourcePath(namedArgs.sourceFile);
        const functions = await loadCodeChunks(sourceFilePath);
        const concurrency = namedArgs.concurrency;
        printer.writeLine(`${functions.length} function/s found.`);
        for (let i = 0; i < functions.length; i += concurrency) {
            let slice = functions.slice(i, i + concurrency);
            if (slice.length === 0) {
                break;
            }
            printer.writeInColor(
                chalk.gray,
                `[Documenting functions ${i + 1} to ${i + slice.length}] / ${functions.length}`,
            );
            const results = await asyncArray.mapAsync(
                slice,
                concurrency,
                (code) =>
                    codeReviewer.document({ code, language: "typescript" }),
            );
            for (let r = 0; r < results.length; ++r) {
                const docs = results[r];
                const code = slice[r];
                const lines = codeToLines(code);
                printer.writeAllDocs(lines, docs);
                printer.writeLine();
            }
        }
    }

    function codeGenDef(): CommandMetadata {
        return {
            description: "Generate code",
            args: {
                def: { description: "What the code should do", type: "string" },
            },
            options: {
                type: { description: "Code type", defaultValue: "Function" },
                language: {
                    defaultValue: "typescript",
                },
                destFile: argDestFile(),
            },
        };
    }
    handlers.codeGen.metadata = codeGenDef();
    async function codeGen(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, codeGenDef());
        const response = await codeGenerator.generate({
            description: namedArgs.def,
            codeType: namedArgs.type,
            language: namedArgs.language,
        });
        if (response.type == "notGenerated") {
            printer.writeError(response.reason ?? "Not generated");
            return;
        }
        printer.writeCodeLines(response.code.linesOfCode);
        if (!namedArgs.destFile) {
            return;
        }
        // And save it
        printer.writeLine("Saving memory...");
        await saveGeneratedCode(response.code, namedArgs.destFile);
    }

    function codeImportDef(): CommandMetadata {
        return {
            description: "Import code into developer memory",
            options: {
                sourceFile: argSourceFile(),
                concurrency: argConcurrency(),
            },
        };
    }
    handlers.codeImport.metadata = codeImportDef();
    async function codeImport(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, codeImportDef());
        const fullPath = getSourcePath(namedArgs.sourceFile);
        const sourceFile = await tsCode.loadSourceFile(fullPath);
        // Currently, we only import top level statements from the file
        let statements = tsCode.getTopLevelStatements(sourceFile);
        statements = statements.filter(
            (s) => tsCode.getStatementName(s) !== undefined,
        );
        if (statements.length === 0) {
            printer.writeLine("No top level statements.");
            return;
        }
        const concurrency = namedArgs.concurrency;
        for (let i = 0; i < statements.length; i += concurrency) {
            let slice = statements.slice(i, i + concurrency);
            if (slice.length === 0) {
                break;
            }
            printer.writeInColor(
                chalk.gray,
                `[Indexing statements ${i + 1} to ${i + slice.length}] / ${statements.length}`,
            );
            const importedNames = await asyncArray.mapAsync(
                slice,
                concurrency,
                (statement) => importStatement(sourceFile, statement, fullPath),
            );
            for (const name of importedNames) {
                if (name) {
                    printer.writeBullet(codeBlockNameToString(name));
                }
            }
        }
    }

    function codeSearchDef(): CommandMetadata {
        return {
            description: "Search for code in memory",
            args: {
                query: argQuery(),
            },
            options: {
                maxMatches: argMaxMatches(),
                minScore: argMinScore(),
            },
        };
    }
    handlers.codeSearch.metadata = codeSearchDef();
    async function codeSearch(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, codeSearchDef());
        const matches = await developerMemory.searchCode(
            namedArgs.query,
            namedArgs.maxMatches,
            namedArgs.minScore,
        );
        for (const match of matches) {
            printer.writeScore(match.score);
            const storedCode = await developerMemory.getById(match.item);
            if (storedCode) {
                printer.writeCode(storedCode.code.code);
            }
        }
    }

    function bugsDef(): CommandMetadata {
        return {
            description: "Display bugs",
            options: {
                query: argQuery(),
                maxMatches: argMaxMatches(),
                minScore: argMinScore(),
                count: argCount(),
            },
        };
    }
    handlers.bugs.metadata = bugsDef();
    async function bugs(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, bugsDef());
        if (namedArgs.query) {
            const searchResults = await developerMemory.bugs.search(
                namedArgs.query,
                namedArgs.maxMatches,
                namedArgs.minScore,
            );
            await showSearchResults(developerMemory.bugs, searchResults, (l) =>
                printer.writeBug(l),
            );
        } else {
            await showReviews(developerMemory.bugs, (l) => printer.writeBug(l));
        }
    }

    function commentsDef(): CommandMetadata {
        return {
            description: "Display comments",
            options: {
                query: argQuery(),
                maxMatches: argMaxMatches(),
                minScore: argMinScore(),
            },
        };
    }
    handlers.comments.metadata = commentsDef();
    async function comments(args: string[] | NamedArgs): Promise<void> {
        const namedArgs = parseNamedArguments(args, commentsDef());
        if (namedArgs.query) {
            const searchResults = await developerMemory.comments.search(
                namedArgs.query,
                namedArgs.maxMatches,
                namedArgs.minScore,
            );
            await showSearchResults(
                developerMemory.comments,
                searchResults,
                (l) => printer.writeComment(l),
            );
        } else {
            await showReviews(developerMemory.comments, (l) =>
                printer.writeComment(l),
            );
        }
    }

    async function cwd() {
        printer.writeLine(process.cwd());
    }

    handlers.cd.metadata = "Change current directory";
    async function cd(args: string[]) {
        if (args.length === 0) {
            printer.writeLine("No directory specified.");
            return;
        }
        process.chdir(args[0]);
        printer.writeLine(process.cwd());
    }

    async function saveGeneratedCode(
        generatedCode: GeneratedCode,
        destFilePath: string,
    ): Promise<void> {
        await writeAllLines(generatedCode.linesOfCode, destFilePath);
        const code = await loadTypescriptCode(destFilePath);
        await importCode(code);
    }

    async function importCode(code: TypeScriptCode): Promise<string> {
        const codeName = codeBlockNameFromFilePath(code.sourcePath);
        return await developerMemory.add(createTypescriptBlock(code), codeName);
    }

    async function importStatement(
        sourceFile: ts.SourceFile,
        statement: ts.Statement,
        fullPath: string,
    ): Promise<CodeBlockName | undefined> {
        let name = tsCode.getStatementName(statement);
        if (!name) {
            return undefined;
        }

        const codeText = tsCode.getTextOfStatement(sourceFile, statement);
        const codeName = codeBlockNameFromFilePath(fullPath, name);
        await developerMemory.add(
            createTypescriptBlock(codeText, fullPath),
            codeName,
        );
        return codeName;
    }

    async function createMemory() {
        return createDeveloperMemory({ codeReviewer }, memoryFolderPath);
    }

    async function showReviews(
        index: CodeReviewIndex,
        callback: (line: LineReview) => void,
        count: number = Number.MAX_SAFE_INTEGER,
    ) {
        let counter = 0;
        for await (const entry of index.store.sequence.newestObjects()) {
            ++counter;
            printer.write(`[${counter}] `);
            printer.writeTimestamp(entry.timestamp);
            const review = await index.store.get(entry.value[0]);
            if (review) {
                await printReview(index, review, callback);
            }
            if (counter === count) {
                break;
            }
        }
    }

    async function showSearchResults(
        index: CodeReviewIndex,
        matchIds: string[],
        callback: (line: LineReview) => void,
    ) {
        if (matchIds.length === 0) {
            printer.writeLine("No matches");
            return;
        }

        for (const id of matchIds) {
            const entry = await index.store.get(id);
            if (entry) {
                await printReview(index, entry, callback);
            }
        }
    }

    async function printReview(
        index: CodeReviewIndex,
        entry: ExtractedCodeReview,
        callback: (line: LineReview) => void,
    ) {
        const source = await developerMemory.getById(entry.sourceId);
        if (source) {
            printer.writeSourceLink(source.sourcePath);
        }
        printer.writeLine(`Line ${entry.value.lineNumber}`);
        callback(entry.value);
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

    function onStart(io: InteractiveIo): void {
        printer = new CodePrinter(io);
    }

    await runConsole({
        onStart,
        inputHandler,
        handlers,
    });
}
