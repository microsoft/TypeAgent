// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Functions for working with typescript code
 */

import { buildChunks, readAllText } from "typeagent";
import ts, { CommentRange, SourceFile, Statement } from "typescript";
import { Module } from "./code.js";

/**
 * Load Typescript source
 * @param filePath
 * @param basePath
 * @returns
 */
export async function loadSourceFile(
    filePath: string,
    basePath?: string,
): Promise<ts.SourceFile> {
    const codeText: string = await readAllText(filePath, basePath);
    const sourceFile = ts.createSourceFile(
        filePath,
        codeText,
        ts.ScriptTarget.Latest,
    );
    return sourceFile;
}

/**
 * Get statements from Typescript source
 * @param sourceFile
 * @param filter
 * @returns
 */
export function getStatements<T extends ts.Statement>(
    sourceFile: ts.SourceFile,
    filter: (s: ts.Statement) => boolean,
): T[] {
    const matches: T[] = [];
    for (const s of sourceFile.statements) {
        if (filter(s)) {
            matches.push(<T>s);
        }
    }
    return matches;
}

export function getTextOfStatement(
    sourceFile: ts.SourceFile,
    s: ts.Statement,
): string {
    let text = getComments(sourceFile, s);
    if (text) {
        text += "\n";
    }
    text += s.getText(sourceFile);
    return text;
}

/**
 * Return all top-level statements in this file
 * @param sourceFile
 */
export function getTopLevelStatements(
    sourceFile: ts.SourceFile,
): ts.Statement[] {
    const statements: Statement[] = [];
    ts.forEachChild(sourceFile, (s) => {
        if (
            ts.isTypeAliasDeclaration(s) ||
            ts.isClassDeclaration(s) ||
            ts.isFunctionDeclaration(s) ||
            ts.isInterfaceDeclaration(s)
        ) {
            statements.push(s);
        }
    });
    return statements;
}

export function getStatementName(statement: ts.Statement): string | undefined {
    if (
        ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)
    ) {
        return statement.name?.text;
    }
    if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)
    ) {
        return statement.name?.escapedText.toString();
    }
    return undefined;
}

/**
 * Return leading and trailing comments on a node
 * @param sourceFile
 * @param node
 * @returns
 */
export function getComments(
    sourceFile: ts.SourceFile,
    node: ts.Node,
    leading: boolean = true,
    trailing: boolean = false,
): string {
    let text = "";
    if (leading) {
        const leadingRanges = ts.getLeadingCommentRanges(
            sourceFile.text,
            node.getFullStart(),
        );
        if (leadingRanges) {
            text += getCommentChunk(sourceFile, leadingRanges);
        }
    }
    if (trailing) {
        const trailingRanges = ts.getTrailingCommentRanges(
            sourceFile.text,
            node.getEnd(),
        );
        if (trailingRanges) {
            text += getCommentChunk(sourceFile, trailingRanges);
        }
    }
    return text;

    function getCommentChunk(
        sourceFile: SourceFile,
        ranges: CommentRange[],
    ): string {
        let text = "";
        for (const comment of ranges) {
            text += sourceFile.text.substring(comment.pos, comment.end);
        }
        return text;
    }
}

/**
 * Get functions from Typescript source
 * @param sourceFile
 * @returns
 */
export function getFunctions(
    sourceFile: ts.SourceFile,
): ts.FunctionDeclaration[] {
    return getStatements<ts.FunctionDeclaration>(
        sourceFile,
        ts.isFunctionDeclaration,
    );
}

/**
 * Iteratively return the name and text of each function in the source file
 * @param sourceFile
 */
export function* getFunctionsText(
    sourceFile: ts.SourceFile,
): IterableIterator<string> {
    for (const s of sourceFile.statements) {
        if (ts.isFunctionDeclaration(s)) {
            yield s.getText(sourceFile);
        }
    }
}

/**
 * Return the text of all top level statements in the file
 * @param sourceFile
 */
export function* getTextOfTopLevelStatements(
    sourceFile: ts.SourceFile,
): IterableIterator<string> {
    for (const s of getTopLevelStatements(sourceFile)) {
        let text = getComments(sourceFile, s);
        if (text) {
            text += "\n";
        }
        text += s.getText(sourceFile);
        yield text;
    }
}

/**
 * Gets blocks of statements, such that the text of the function block does not exceed maxCharsPerChunk
 * @param sourceFile
 * @param maxCharsPerChunk
 * @returns
 */
export function getStatementChunks(
    sourceFile: ts.SourceFile,
    maxCharsPerChunk: number,
): IterableIterator<string> {
    const statements = [...getTextOfTopLevelStatements(sourceFile)];
    return buildChunks(statements, maxCharsPerChunk, "\n");
}

/**
 * Load text for typescript functions from a file
 * @param filePath
 * @param basePath
 * @returns Text for all functions
 */
export async function loadFunctionsTextFromFile(
    filePath: string,
    basePath?: string,
): Promise<string[]> {
    const sourceFile = await loadSourceFile(filePath, basePath);
    return [...getFunctionsText(sourceFile)];
}

/**
 * Gets blocks of text at statement boundaries, such that the text of the function block does not exceed maxCharsPerChunk
 * @param filePath
 * @param maxCharsPerChunk
 * @returns
 */
export async function loadChunksFromFile(
    filePath: string,
    maxCharsPerChunk: number,
    basePath?: string,
): Promise<string[]> {
    const sourceFile = await loadSourceFile(filePath, basePath);
    return [...getStatementChunks(sourceFile, maxCharsPerChunk)];
}

/**
 * Get all imports from a Typescript file
 * @param sourceFile
 * @returns
 */
export async function getImports(sourceFile: ts.SourceFile): Promise<string[]> {
    const imports = getStatements<ts.ImportDeclaration>(
        sourceFile,
        ts.isImportDeclaration,
    );
    return imports.map((i) =>
        ts.isStringLiteral(i.moduleSpecifier) ? i.moduleSpecifier.text : "",
    );
}

/**
 * Load typescript modules.
 * Currently very simplistic. Only works if if your modules names are are files in baseDirPath. Relative paths not supported
 * @param sourceFile import modules from this file
 * @param baseDirPath directory where modules are located.
 * @returns
 */
export async function loadImports(
    sourceFile: ts.SourceFile,
    baseDirPath?: string,
): Promise<Module[]> {
    const imports = await getImports(sourceFile);
    const modules: Module[] = [];
    for (const moduleName of imports) {
        const text = await readAllText(moduleName, baseDirPath);
        modules.push({ text, moduleName });
    }
    return modules;
}

function isExported(
    statement: ts.TypeAliasDeclaration | ts.InterfaceDeclaration,
): boolean {
    if (statement.modifiers) {
        return statement.modifiers.some(
            (m) => m.kind === ts.SyntaxKind.ExportKeyword,
        );
    }
    return false;
}

export type Schema = {
    types?: ts.TypeAliasDeclaration[];
    interfaces?: ts.InterfaceDeclaration[];
};

export function getSchemaTypes(sourceFile: ts.SourceFile): Schema {
    const types = getStatements<ts.TypeAliasDeclaration>(
        sourceFile,
        (s) => ts.isTypeAliasDeclaration(s) && isExported(s),
    );

    const interfaces = getStatements<ts.InterfaceDeclaration>(
        sourceFile,
        (s) => ts.isInterfaceDeclaration(s) && isExported(s),
    );
    return { types, interfaces };
}
