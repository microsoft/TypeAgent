#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
// ═══════════════════════════════════════════════════════════════════════════
// cli.ts — Unified entry point for mcp-plan-validation
//
// Usage:
//   mcp-plan-validation init [--policy strict|dev|ml|ci]
//   mcp-plan-validation serve [--policy ./policy.json]
//   mcp-plan-validation (no subcommand → starts MCP server)
//
// When published to npm, this is the bin entry point:
//   npx mcp-plan-validation init --policy dev
//   npx mcp-plan-validation --policy ./my-policy.json
// ═══════════════════════════════════════════════════════════════════════════

export {}; // Make this file a module for top-level await

const subcommand = process.argv[2];

if (subcommand === "init") {
    // Remove "init" from argv so the init script sees clean args
    process.argv.splice(2, 1);
    await import("./init.js");
} else if (subcommand === "serve") {
    process.argv.splice(2, 1);
    await import("./index.js");
} else {
    // Default: start MCP server (backward compatible)
    await import("./index.js");
}
