// Copyright (c) Microsoft Corporation
// Licensed under the MIT License.

import { CommandHandler } from "interactive-app";

export function createKnowproCommands(
    commands: Record<string, CommandHandler>,
): void {
    commands.kpLoadIndex = loadIndex;
    commands.kpSaveIndex = saveIndex;
    commands.kpSearch = searchIndex;

    commands.kpLoadIndex.metadata = "Load knowPro index";
    async function loadIndex(args: string[]): Promise<void> {}

    commands.kpSaveIndex.metadata = "Save knowPro index";
    async function saveIndex(args: string[]): Promise<void> {}

    commands.kpSearch.metadata = "Search knowPro index";
    async function searchIndex(): Promise<void> {}
}
