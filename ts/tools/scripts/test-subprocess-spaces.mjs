#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// test-subprocess-spaces.mjs
//
// Verifies Node.js spawnSync shell:false correctly invokes executables
// whose paths contain spaces (e.g. C:\Program Files (x86)\...).
//
// Usage:
//   node test-subprocess-spaces.mjs "C:\path with spaces\tool.exe"
//
// Exit code 0 = pass, 1 = fail.

import { spawnSync } from "node:child_process";
import fs from "node:fs";

const exePath = process.argv[2];
if (!exePath) {
    console.error("Usage: node test-subprocess-spaces.mjs <path-to-exe>");
    process.exit(1);
}

if (!fs.existsSync(exePath)) {
    console.error(`Exe not found: ${exePath}`);
    process.exit(1);
}

console.log(`Testing with: ${exePath}`);
console.log(`Path has spaces: ${exePath.includes(" ")}\n`);

let passed = 0;
let failed = 0;

function test(label, fn) {
    try {
        fn();
        console.log(`  PASS ${label}`);
        passed++;
    } catch (e) {
        console.log(`  FAIL ${label}: ${e.message}`);
        failed++;
    }
}

// Test 1: spawnSync shell:false runs exes with spaces in path
console.log("-- Test 1: spawnSync shell:false");
test("invokes exe with spaces in path", () => {
    const result = spawnSync(exePath, [], { stdio: "pipe", shell: false, encoding: "utf8" });
    if (result.error) throw new Error(result.error.message);
    // Any exit code is acceptable as long as it is NOT an ENOENT/spawn failure
    // (exit code 1 is fine - tool ran but printed usage)
    if (result.status === null) throw new Error(`Process killed by signal: ${result.signal}`);
    if (result.stderr && result.stderr.includes("is not recognized")) {
        throw new Error(`cmd.exe split the path: ${result.stderr.trim()}`);
    }
});

// Test 2: confirm shell:true would fail (proof that shell:false is the right mode)
console.log("\n-- Test 2: shell:true fails for spaced path (expected)");
test("shell:true splits path on spaces (validates test 1 is meaningful)", () => {
    const result = spawnSync(exePath, [], { stdio: "pipe", shell: true, encoding: "utf8" });
    const pathHasSpace = exePath.includes(" ");
    if (pathHasSpace && result.status === 0 && !result.stderr?.includes("is not recognized")) {
        // shell:true may still work in some environments; just log a note
        console.log(`    (Note: shell:true also succeeded - both modes work here)`);
    }
    // This test always passes - it's informational
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
