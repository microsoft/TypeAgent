#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI entry point. On PATH as `git-commit-story`, so git also runs it as
// `git commit-story <command>`.
import { Command } from "commander";

const program = new Command("git-commit-story")
    .description("Attach agent session stories to git commits")
    .version("0.0.1");

program
    .command("hello")
    .description("Print a greeting")
    .action(() => console.log("Hello from git-commit-story"));

program.parse();
