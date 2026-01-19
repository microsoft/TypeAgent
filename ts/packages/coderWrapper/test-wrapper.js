#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Simple test of the PTY wrapper with Node REPL

import { PtyWrapper } from "./dist/index.js";

console.log("[Test] Testing PTY wrapper with Node REPL...");
console.log("[Test] Type 'console.log(\"Hello from Node!\")' to test");
console.log("[Test] Type '.exit' to quit\n");

const config = {
    name: "Node REPL",
    command: "node",
    args: [],
};

const wrapper = new PtyWrapper(config, {
    cols: process.stdout.columns,
    rows: process.stdout.rows,
});

wrapper.spawn();

// Handle Ctrl+C
process.on("SIGINT", () => {
    console.log("\n[Test] Shutting down...");
    wrapper.kill();
    process.exit(0);
});

// Keep process alive
const checkInterval = setInterval(() => {
    if (!wrapper.isRunning()) {
        console.log("[Test] Node REPL exited");
        clearInterval(checkInterval);
        process.exit(0);
    }
}, 1000);
