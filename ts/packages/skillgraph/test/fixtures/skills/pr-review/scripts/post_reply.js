// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Post a reply to a PR review thread.
import { program } from "commander";

program
    .option("--pr <number>", "PR number")
    .option("--body <text>", "Reply body");
program.parse();
