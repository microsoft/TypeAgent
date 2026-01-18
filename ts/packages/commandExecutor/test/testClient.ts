// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

async function testCommandServer() {
    console.log("Creating MCP client...");

    const client = new Client({
        name: "Test-Client",
        version: "1.0.0",
    });

    const transport = new StdioClientTransport({
        command: "node",
        args: ["../dist/server.js"],
    });

    await client.connect(transport);
    console.log("Connected to Command Executor Server\n");

    // Test 1: Execute a music command
    console.log("Test 1: Play music command");
    const musicResult = (await client.callTool({
        name: "execute_command",
        arguments: { request: "play shake it off by taylor swift" },
    })) as CallToolResult;
    console.log(
        "Response:",
        musicResult.content[0].type === "text"
            ? musicResult.content[0].text
            : "No text response",
    );
    console.log();

    // Test 2: Execute a list command
    console.log("Test 2: Add to list command");
    const listResult = (await client.callTool({
        name: "execute_command",
        arguments: { request: "add ham to my grocery list" },
    })) as CallToolResult;
    console.log(
        "Response:",
        listResult.content[0].type === "text"
            ? listResult.content[0].text
            : "No text response",
    );
    console.log();

    // Test 3: Execute a calendar command
    console.log("Test 3: Calendar command");
    const calendarResult = (await client.callTool({
        name: "execute_command",
        arguments: { request: "add meeting tomorrow at 3pm" },
    })) as CallToolResult;
    console.log(
        "Response:",
        calendarResult.content[0].type === "text"
            ? calendarResult.content[0].text
            : "No text response",
    );
    console.log();

    // Test 4: Ping diagnostic tool
    console.log("Test 4: Ping diagnostic");
    const pingResult = (await client.callTool({
        name: "ping",
        arguments: { message: "test connection" },
    })) as CallToolResult;
    console.log(
        "Response:",
        pingResult.content[0].type === "text"
            ? pingResult.content[0].text
            : "No text response",
    );
    console.log();

    await client.close();
    console.log("All tests completed successfully!");
}

testCommandServer().catch(console.error);
