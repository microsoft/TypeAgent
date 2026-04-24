// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// ═══════════════════════════════════════════════════════════════════════════
// index.ts - MCP server entry point (stdio transport)
//
// Usage:
//   node dist/index.js
//   node dist/index.js --policy ./policy.json
//
// Claude Code config (~/.claude/settings.json):
//   {
//     "mcpServers": {
//       "plan-validation": {
//         "command": "node",
//         "args": ["<path-to>/tools/mcpValidation/dist/index.js", "--policy", "<path-to>/policy.json"]
//       }
//     }
//   }
// ═══════════════════════════════════════════════════════════════════════════

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadOrgPolicy, type OrgPolicy } from "validation";
import { createValidationServer } from "./server.js";

async function main() {
    // Parse --policy argument
    const args = process.argv.slice(2);
    const policyIndex = args.indexOf("--policy");
    let policy: OrgPolicy | undefined;

    if (policyIndex !== -1 && args[policyIndex + 1]) {
        const policyPath = args[policyIndex + 1];
        policy = loadOrgPolicy(policyPath);
        console.error(`Loaded org policy: "${policy.name}"`);
    }

    const serverArgs: { policy?: OrgPolicy } = {};
    if (policy) serverArgs.policy = policy;
    const { server } = createValidationServer(serverArgs);
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("plan-validation MCP server running on stdio");
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
