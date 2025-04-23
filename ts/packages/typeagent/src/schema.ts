// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Module with Schema related functions
import fs from "fs";
import ts from "typescript";
import { fileURLToPath } from "url";

/**
 * Schema for a type
 */
export type TypeSchema = {
    /**
     * Name of the type for which this is a schema
     */
    typeName: string;
    /**
     * Schema text for the type
     */
    schemaText: string;
};

/**
 * Loads schema files and combines them into one
 * Also removes all import statements from the combined file, to prevent
 * module install/dependency issues when TypeChat validates messages
 * @param filePaths file paths to import from
 * @param basePath base path if file paths are relative
 * @returns
 */
export function loadSchema(filePaths: string[], basePath?: string): string {
    let schemaText = "";
    for (const fileText of loadSchemaFiles(filePaths, basePath)) {
        schemaText += fileText;
        schemaText += "\n";
    }
    return schemaText;
}

export function loadSchemaFiles(
    filePaths: string[],
    basePath?: string,
): string[] {
    const schemaText: string[] = [];
    for (const file of filePaths) {
        let filePath = file;
        if (basePath) {
            filePath = fileURLToPath(new URL(file, basePath));
        }
        const rawText: string = fs.readFileSync(filePath, "utf-8");
        let fileText = stripImports(filePath, rawText);
        fileText = stripCopyright(fileText);
        schemaText.push(fileText);
    }
    return schemaText;
}

function stripImports(filePath: string, schemaText: string) {
    const sourceFile = ts.createSourceFile(
        filePath,
        schemaText,
        ts.ScriptTarget.Latest,
    );
    const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
    const nodes = sourceFile?.statements.filter((node) => {
        return !ts.isImportDeclaration(node);
    });

    let text = "";
    nodes!.forEach(
        (n) =>
            (text +=
                printer.printNode(ts.EmitHint.Unspecified, n, sourceFile!) +
                "\n"),
    );
    return text;
}

function stripCopyright(schemaText: string): string {
    schemaText = schemaText.replace(
        "// Copyright (c) Microsoft Corporation.",
        "",
    );
    schemaText = schemaText.replace("// Licensed under the MIT License.", "");
    return schemaText;
}
