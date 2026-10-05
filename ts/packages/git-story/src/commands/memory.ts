// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Command } from "commander";
import { findRepository } from "../git.js";
import { askStoryMemory, syncStoryMemory } from "../memory/storyMemory.js";

function repository(): string {
    const value = findRepository(process.cwd());
    if (!value) throw new Error("Not a Git repository");
    return value;
}

export const memoryCommand = new Command("memory").description(
    "Manage commit story memory",
);

memoryCommand
    .command("sync")
    .description("Index commit stories in KnowPro")
    .action(async () => {
        const result = await syncStoryMemory(repository());
        process.stdout.write(
            `Indexed ${result.indexed} commit stor${result.indexed === 1 ? "y" : "ies"}; skipped ${result.skipped}.\n`,
        );
    });

export const askCommand = new Command("ask")
    .description("Ask a question about commit stories")
    .argument("<question>", "question to answer")
    .action(async (question: string) => {
        process.stdout.write(
            `${await askStoryMemory(repository(), question)}\n`,
        );
    });
