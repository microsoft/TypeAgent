#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PtyWrapper } from "./ptyWrapper.js";
import { getAssistantConfig } from "./assistantConfig.js";

/**
 * Parse command line arguments
 */
function parseArgs(): { assistant: string; help: boolean } {
    const args = process.argv.slice(2);
    let assistant = "claude";
    let help = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
            help = true;
        } else if (arg === "--assistant" || arg === "-a") {
            assistant = args[++i];
        }
    }

    return { assistant, help };
}

/**
 * Print usage information
 */
function printUsage(): void {
    console.log(`
Usage: coder-wrapper [options]

Options:
  -a, --assistant <name>  Specify the assistant to use (default: claude)
  -h, --help             Show this help message

Available assistants:
  claude                 Claude Code CLI

Examples:
  coder-wrapper                    # Use Claude Code (default)
  coder-wrapper -a claude          # Explicitly use Claude Code

Description:
  Wraps CLI coding assistants in a pseudo terminal with caching support.
  The wrapper transparently passes through all I/O to/from the assistant.
  Future versions will add TypeAgent cache checking before forwarding requests.
`);
}

/**
 * Main CLI entry point
 */
async function main() {
    const { assistant, help } = parseArgs();

    if (help) {
        printUsage();
        process.exit(0);
    }

    try {
        // Get assistant configuration
        const config = getAssistantConfig(assistant);

        console.log(`[CoderWrapper] Starting ${config.name}...`);
        console.log(
            `[CoderWrapper] Command: ${config.command} ${config.args.join(" ")}`,
        );
        console.log(
            `[CoderWrapper] Press Ctrl+C to exit or type 'exit' in the assistant\n`,
        );

        // Create and spawn the PTY wrapper
        const wrapper = new PtyWrapper(config, {
            cols: process.stdout.columns,
            rows: process.stdout.rows,
        });

        wrapper.spawn();

        // Handle Ctrl+C gracefully
        process.on("SIGINT", () => {
            console.log("\n[CoderWrapper] Received SIGINT, shutting down...");
            wrapper.kill();
            process.exit(0);
        });

        // Handle SIGTERM
        process.on("SIGTERM", () => {
            console.log("\n[CoderWrapper] Received SIGTERM, shutting down...");
            wrapper.kill();
            process.exit(0);
        });

        // Keep process alive while wrapper is running
        const checkInterval = setInterval(() => {
            if (!wrapper.isRunning()) {
                clearInterval(checkInterval);
                process.exit(0);
            }
        }, 1000);
    } catch (error) {
        console.error(
            `[CoderWrapper] Error: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(1);
    }
}

// Run the CLI
main().catch((error) => {
    console.error(
        `[CoderWrapper] Fatal error: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
});
