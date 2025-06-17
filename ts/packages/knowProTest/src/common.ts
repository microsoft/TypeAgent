// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import { ArgDef, NamedArgs, parseCommandLine } from "interactive-app";
import path from "path";
import { getFileName } from "typeagent";
import { error, Result } from "typechat";
import * as kp from "knowpro";
import * as cm from "conversation-memory";

export function ensureDirSync(folderPath: string): string {
    if (!fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
    }
    return folderPath;
}

export function getCommandArgs(line: string | undefined): string[] {
    if (line !== undefined && line.length > 0) {
        const args = parseCommandLine(line);
        if (args !== null && args.length > 0) {
            if (args[0].startsWith("@")) {
                args.shift();
            }
            return args;
        }
    }
    return [];
}

export async function execCommandLine<T>(
    line: string,
    cb: (args: string[], cmdLine: string) => Promise<Result<T>>,
): Promise<Result<T>> {
    const args = parseCommandLine(line);
    if (args !== null && args.length > 0) {
        if (args[0].startsWith("@")) {
            args.shift();
        }
        if (args && args.length > 0) {
            return await cb(args, line);
        }
    }

    return error("No args");
}

export function argSourceFile(defaultValue?: string | undefined): ArgDef {
    return {
        description: "Path to source file",
        type: "path",
        defaultValue,
    };
}

export function addFileNameSuffixToPath(sourcePath: string, suffix: string) {
    return path.join(
        path.dirname(sourcePath),
        getFileName(sourcePath) + suffix,
    );
}

const IndexFileSuffix = "_index.json";
export function sourcePathToMemoryIndexPath(
    sourcePath: string,
    indexFilePath?: string,
): string {
    return (
        indexFilePath ?? addFileNameSuffixToPath(sourcePath, IndexFileSuffix)
    );
}

export function memoryNameToIndexPath(
    basePath: string,
    memoryName: string,
): string {
    return path.join(basePath, memoryName + IndexFileSuffix);
}

export function shouldParseRequest(
    obj: string[] | NamedArgs | any,
): obj is string[] | NamedArgs {
    return Array.isArray(obj) || isNamedArgs(obj);
}

function isNamedArgs(obj: any): obj is NamedArgs {
    if (typeof obj === "object") {
        const na = obj as NamedArgs;
        return na.bind !== undefined && na.value !== undefined;
    }

    return false;
}

export function isJsonEqual(x: any | undefined, y: any | undefined): boolean {
    if (x === undefined && y === undefined) {
        return true;
    } else if (x !== undefined && y !== undefined) {
        const jx = JSON.stringify(x);
        const jy = JSON.stringify(y);
        return jx === jy;
    }
    return false;
}

export function compareArray(
    name: string,
    x: any[] | undefined,
    y: any[] | undefined,
    sort: boolean = true,
): string | undefined {
    if (x === undefined && y === undefined) {
        return undefined;
    }
    if (x === undefined || y === undefined || x.length != y.length) {
        return `${name}: length mismatch`;
    }
    if (sort) {
        x = [...x].sort();
        y = [...y].sort();
    }
    for (let i = 0; i < x.length; ++i) {
        if (x[i] !== y[i]) {
            return `${name}[${i}]: ${x[i]} !== ${y[i]}`;
        }
    }
    return undefined;
}

export async function getLangSearchResult(
    conversation: kp.IConversation | cm.Memory,
    queryTranslator: kp.SearchQueryTranslator,
    searchText: string,
    options?: kp.LanguageSearchOptions,
    langFilter?: kp.LanguageSearchFilter,
    debugContext?: kp.LanguageSearchDebugContext,
) {
    const searchResults =
        conversation instanceof cm.Memory
            ? await conversation.searchWithLanguage(
                  searchText,
                  options,
                  langFilter,
                  debugContext,
              )
            : await kp.searchConversationWithLanguage(
                  conversation,
                  searchText,
                  queryTranslator,
                  options,
                  langFilter,
                  debugContext,
              );

    return searchResults;
}
