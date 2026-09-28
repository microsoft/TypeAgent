#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// CLI entry point. On PATH as `git-commit-story`, so git also runs it as
// `git commit-story <command>`.
import { execFileSync } from "node:child_process";
import { init } from "./init.js";

const [command] = process.argv.slice(2);
switch (command) {
    case "init":
        // Settings live at the repo root, even when run from a subdirectory.
        // Throws outside a git repo.
        init(
            execFileSync("git", ["rev-parse", "--show-toplevel"], {
                encoding: "utf8",
            }).trim(),
        );
        break;
    default:
        console.log("Hello from git-commit-story");
}
