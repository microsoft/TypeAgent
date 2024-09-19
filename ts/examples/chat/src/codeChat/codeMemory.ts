import { openai } from "aiclient";
import {
    codeBlockNameFromFilePath,
    codeBlockNameToString,
    CodeReviewIndex,
    createCodeReviewer,
    createDeveloperMemory,
    ExtractedCodeReview,
    LineReview,
    tsCode,
} from "code-processor";
import { CodePrinter } from "./codePrinter.js";
import {
    addStandardHandlers,
    CommandHandler,
    CommandMetadata,
    InteractiveIo,
    parseNamedArguments,
    runConsole,
} from "interactive-app";
import {
    argConcurrency,
    argMaxMatches,
    argMinScore,
    argQuery,
    argSourcePath,
    argVerbose,
    createTypescriptBlock,
    getSourcePath,
    loadTypescriptCode,
    TypeScriptCode,
} from "./common.js";
import { asyncArray, removeDir } from "typeagent";
import ts from "typescript";

export async function runCodeMemory(): Promise<void> {
    const chatModel = openai.createChatModel();
    const memoryFolderPath = "/data/code/memory";
    const codeReviewer = createCodeReviewer(chatModel);
    let developerMemory = await createMemory();
    let printer: CodePrinter;

    const handlers: Record<string, CommandHandler> = {
        clearMemory,
        codeReview,
        codeImport,
        bugs,
        comments,
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
        printer.writeLine("\nDeveloper Memory");
    }

    handlers.clearMemory.metadata = "Clear memory";
    async function clearMemory(): Promise<void> {
        await removeDir(memoryFolderPath);
        developerMemory = await createMemory();
    }

    function codeReviewDef(): CommandMetadata {
        return {
            description: "Review the given Typescript file",
            options: {
                sourceFile: argSourcePath(),
                verbose: argVerbose(),
                save: {
                    type: "boolean",
                    defaultValue: false,
                },
            },
        };
    }
    handlers.codeReview.metadata = codeReviewDef();
    async function codeReview(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args, codeReviewDef());
        const codeName = codeBlockNameFromFilePath(namedArgs.sourceFile);
        console.log(codeBlockNameToString(codeName));
        printer.writeLine(`Source file:\n${namedArgs.sourceFile}`);

        // Load file to review
        const code = await loadTypescriptCode(namedArgs.sourceFile);
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

    function codeImportDef(): CommandMetadata {
        return {
            description: "Import code into developer memory",
            options: {
                sourceFile: argSourcePath(),
                concurrency: argConcurrency(),
            },
        };
    }
    handlers.codeImport.metadata = codeImportDef();
    async function codeImport(args: string[]): Promise<void> {
        const namedArgs = parseNamedArguments(args);
        const fullPath = getSourcePath(namedArgs.sourceFile);
        const sourceFile = await tsCode.loadSourceFile(fullPath);
        // Currently, we only import top level statements from the file
        const statements = tsCode.getTopLevelStatements(sourceFile);
        await asyncArray.forEachAsync(
            statements,
            namedArgs.concurrency,
            async (statement, index) => {
                if (
                    await importStatement(
                        sourceFile,
                        statement,
                        fullPath,
                        namedArgs.verbose,
                    )
                ) {
                }
            },
        );
    }

    function bugsDef(): CommandMetadata {
        return {
            description: "Display bugs",
            options: {
                query: argQuery(),
                maxMatches: argMaxMatches(),
                minScore: argMinScore(),
            },
        };
    }
    handlers.bugs.metadata = bugsDef();
    async function bugs(args: string[]): Promise<void> {
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
    async function comments(args: string[]): Promise<void> {
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

    async function importCode(code: TypeScriptCode): Promise<string> {
        const codeName = codeBlockNameFromFilePath(code.sourcePath);
        return await developerMemory.add(createTypescriptBlock(code), codeName);
    }

    async function importStatement(
        sourceFile: ts.SourceFile,
        statement: ts.Statement,
        fullPath: string,
        verbose: boolean = false,
    ): Promise<boolean> {
        let name = tsCode.getStatementName(statement);
        if (!name) {
            return false;
        }

        const codeText = tsCode.getTextOfStatement(sourceFile, statement);
        const codeName = codeBlockNameFromFilePath(fullPath, name);
        await developerMemory.add(
            createTypescriptBlock(codeText, fullPath),
            codeName,
        );
        if (verbose) {
            printer.writeTitle(name);
            printer.writeLine(codeText);
        } else {
            printer.writeBullet(name);
        }

        return true;
    }

    async function createMemory() {
        return createDeveloperMemory({ codeReviewer }, memoryFolderPath);
    }

    async function showReviews(
        index: CodeReviewIndex,
        callback: (line: LineReview) => void,
    ) {
        for await (const entry of index.store.entries()) {
            await printReview(index, entry, callback);
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
        for (const line of entry.value) {
            printer.writeLine(`Line ${line.lineNumber}`);
            callback(line);
        }
    }
}
