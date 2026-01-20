#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { PtyWrapper } from "./ptyWrapper.js";
import { getAssistantConfig } from "./assistantConfig.js";

/**
 * Parse command line arguments
 */
function parseArgs(): { assistant: string; help: boolean; debug: boolean } {
    const args = process.argv.slice(2);
    let assistant = "claude";
    let help = false;
    let debug = false;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--help" || arg === "-h") {
            help = true;
        } else if (arg === "--assistant" || arg === "-a") {
            assistant = args[++i];
        } else if (arg === "--debug" || arg === "-d") {
            debug = true;
        }
    }

    return { assistant, help, debug };
}

/**
 * Print usage information
 */
function printUsage(): void {
    console.log(`
Usage: coder-wrapper [options]

Options:
  -a, --assistant <name>  Specify the assistant to use (default: claude)
  -d, --debug            Enable debug logging with cache timing information
  -h, --help             Show this help message

Available assistants:
  claude                 Claude Code CLI

Examples:
  coder-wrapper                    # Use Claude Code (default)
  coder-wrapper -a claude          # Explicitly use Claude Code
  coder-wrapper --debug            # Enable debug logging

Description:
  Wraps CLI coding assistants in a pseudo terminal with caching support.
  The wrapper checks the TypeAgent cache before forwarding requests to the assistant.
  Cache hits are executed and returned immediately without calling the assistant.
`);
}

/**
 * Main CLI entry point
 */
async function main() {
    const { assistant, help, debug } = parseArgs();

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
        if (debug) {
            console.log(
                `[CoderWrapper] Debug mode enabled - cache timing will be logged`,
            );
        }
        console.log(
            `[CoderWrapper] Press Ctrl+C to exit or type 'exit' in the assistant\n`,
        );

        // Create and spawn the PTY wrapper
        const wrapper = new PtyWrapper(config, {
            cols: process.stdout.columns,
            rows: process.stdout.rows,
            debug,
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
