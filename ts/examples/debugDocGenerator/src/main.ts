// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DebugCall {
    namespace: string;
    file: string;
    line: number;
    variableName: string;
}

interface DebugHierarchy {
    [key: string]: {
        calls: DebugCall[];
        children: DebugHierarchy;
    };
}

/**
 * Recursively scan directories for TypeScript files
 */
function scanDirectory(
    dir: string,
    extensions: string[] = [".ts", ".mts"],
): string[] {
    const files: string[] = [];

    try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                // Skip node_modules and other common directories to avoid
                if (
                    !["node_modules", ".git", "dist", "build"].includes(
                        entry.name,
                    )
                ) {
                    files.push(...scanDirectory(fullPath, extensions));
                }
            } else if (entry.isFile()) {
                if (extensions.some((ext) => entry.name.endsWith(ext))) {
                    files.push(fullPath);
                }
            }
        }
    } catch (error) {
        console.warn(`Unable to scan directory ${dir}:`, error);
    }

    return files;
}

/**
 * Extract registerDebug calls from a file
 */
function extractDebugCalls(filePath: string): DebugCall[] {
    const calls: DebugCall[] = [];

    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;

            // Look for registerDebug calls with quoted namespace
            const registerDebugMatch = line.match(
                /registerDebug\s*\(\s*["']([^"']+)["']\s*\)/,
            );
            if (registerDebugMatch) {
                const [, namespace] = registerDebugMatch;
                calls.push({
                    namespace,
                    file: filePath,
                    line: lineNumber,
                    variableName: "debug",
                });
            }
        }
    } catch (error) {
        console.warn(`Unable to read file ${filePath}:`, error);
    }

    return calls;
}

/**
 * Build hierarchy from debug calls
 */
function buildHierarchy(calls: DebugCall[]): DebugHierarchy {
    const hierarchy: DebugHierarchy = {};

    for (const call of calls) {
        const parts = call.namespace.split(":");
        let current = hierarchy;

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];

            if (!current[part]) {
                current[part] = {
                    calls: [],
                    children: {},
                };
            }

            // Add the call to the deepest level
            if (i === parts.length - 1) {
                current[part].calls.push(call);
            }

            current = current[part].children;
        }
    }

    return hierarchy;
}

/**
 * Generate a flat list of all namespaces
 */
function generateFlatList(calls: DebugCall[]): string[] {
    const lines: string[] = [];
    const namespaces = Array.from(
        new Set(calls.map((call) => call.namespace)),
    ).sort();

    for (const namespace of namespaces) {
        lines.push(`- \`${namespace}\``);
    }

    return lines;
}

/**
 * Build file-based hierarchy
 */
function buildFileHierarchy(calls: DebugCall[]): {
    [file: string]: DebugCall[];
} {
    const fileHierarchy: { [file: string]: DebugCall[] } = {};

    for (const call of calls) {
        const relativePath = path
            .relative(process.cwd(), call.file)
            .replace(/\\/g, "/");
        if (!fileHierarchy[relativePath]) {
            fileHierarchy[relativePath] = [];
        }
        fileHierarchy[relativePath].push(call);
    }

    // Sort calls within each file by line number
    for (const file in fileHierarchy) {
        fileHierarchy[file].sort((a, b) => a.line - b.line);
    }

    return fileHierarchy;
}

/**
 * Generate markdown for file hierarchy
 */
function generateFileHierarchy(fileHierarchy: {
    [file: string]: DebugCall[];
}): string[] {
    const lines: string[] = [];
    const sortedFiles = Object.keys(fileHierarchy).sort();

    for (const file of sortedFiles) {
        const calls = fileHierarchy[file];
        const fileLink = `[${file}](${file})`;
        lines.push(`- **${fileLink}**`);

        for (const call of calls) {
            const lineLink = `[Line ${call.line}](${file}#L${call.line})`;
            lines.push(`  - \`${call.namespace}\` at ${lineLink}`);
        }
    }

    return lines;
}

/**
 * Generate markdown documentation from hierarchy
 */
function generateMarkdown(
    hierarchy: DebugHierarchy,
    level: number = 0,
): string[] {
    const lines: string[] = [];
    const indent = "  ".repeat(level);

    for (const [namespace, data] of Object.entries(hierarchy).sort()) {
        const hasChildren = Object.keys(data.children).length > 0;
        const hasCalls = data.calls.length > 0;

        if (hasCalls || hasChildren) {
            lines.push(`${indent}- **${namespace}**`);

            if (hasCalls) {
                for (const call of data.calls) {
                    const relativePath = path
                        .relative(process.cwd(), call.file)
                        .replace(/\\/g, "/");
                    // Create GitHub link to the specific line
                    const fileLink = `[${relativePath}:${call.line}](${relativePath}#L${call.line})`;
                    lines.push(
                        `${indent}  - \`${call.variableName}\` in ${fileLink}`,
                    );
                }
            }

            if (hasChildren) {
                lines.push(...generateMarkdown(data.children, level + 1));
            }
        }
    }

    return lines;
}

/**
 * Generate the debug documentation
 */
function generateDebugDoc(rootPath: string): void {
    console.log("Scanning for registerDebug calls...");

    // Find all TypeScript/JavaScript files
    const files = scanDirectory(rootPath);
    console.log(`Found ${files.length} files to scan`);

    // Extract all debug calls
    const allCalls: DebugCall[] = [];
    for (const file of files) {
        const calls = extractDebugCalls(file);
        allCalls.push(...calls);
    }

    console.log(`Found ${allCalls.length} registerDebug calls`);

    // Build hierarchy
    const hierarchy = buildHierarchy(allCalls);
    const fileHierarchy = buildFileHierarchy(allCalls);

    // Generate markdown
    const markdownLines = [
        "# Debug Namespace Hierarchy",
        "",
        "This document lists all `registerDebug` calls in the TypeAgent codebase,",
        "organized by namespace hierarchy. Use this to determine which debug",
        "namespaces to enable when debugging specific components.",
        "",
        "## Table of Contents",
        "",
        "1. [Usage](#usage)",
        "2. [All Namespaces (Flat List)](#all-namespaces-flat-list)",
        "3. [Namespace Hierarchy](#namespace-hierarchy)",
        "4. [File-based Organization](#file-based-organization)",
        "",
        "## Usage",
        "",
        "To enable debugging for a specific namespace, set the `DEBUG` environment variable:",
        "",
        "```bash",
        "# Enable all typeagent debug messages",
        "DEBUG=typeagent:* npm start",
        "",
        "# Enable only shell-related debug messages",
        "DEBUG=typeagent:shell:* npm start",
        "",
        "# Enable specific debug logger",
        "DEBUG=typeagent:shell:speech npm start",
        "",
        "# Enable multiple namespaces",
        "DEBUG=typeagent:shell:*,typeagent:browser:* npm start",
        "```",
        "",
        "[↑ Back to Top](#debug-namespace-hierarchy)",
        "",
        "## All Namespaces (Flat List)",
        "",
        "Complete list of all debug namespaces found in the codebase:",
        "",
        ...generateFlatList(allCalls),
        "",
        "[↑ Back to Top](#debug-namespace-hierarchy)",
        "",
        "## Namespace Hierarchy",
        "",
        ...generateMarkdown(hierarchy),
        "",
        "[↑ Back to Top](#debug-namespace-hierarchy)",
        "",
        "## File-based Organization",
        "",
        "Debug calls organized by source file:",
        "",
        ...generateFileHierarchy(fileHierarchy),
        "",
        "[↑ Back to Top](#debug-namespace-hierarchy)",
        "",
        "---",
        "",
        `*Generated on ${new Date().toISOString()} from ${allCalls.length} registerDebug calls*`,
    ];

    // Write to file
    const outputPath = path.join(process.cwd(), "debug-hierarchy.md");
    fs.writeFileSync(outputPath, markdownLines.join("\n"), "utf-8");

    console.log(`Debug documentation generated: ${outputPath}`);
    console.log(
        `Found ${allCalls.length} debug calls across ${files.length} files`,
    );
}

/**
 * Main function
 */
function main(): void {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) {
        console.log("Debug Documentation Generator");
        console.log("");
        console.log("Usage: node dist/main.js [PATH]");
        console.log("");
        console.log("Arguments:");
        console.log(
            "  PATH    Path to scan for registerDebug calls (default: three folders up from tool location)",
        );
        console.log("");
        console.log("Options:");
        console.log("  -h, --help    Show this help message");
        console.log("");
        console.log("Examples:");
        console.log("  node dist/main.js");
        console.log("  node dist/main.js /path/to/project");
        console.log("  node dist/main.js ../../../packages");
        return;
    }

    // Default to three folders up from the compiled code location
    // dist/ -> debugDocGenerator/ -> examples/ -> ts/
    const rootPath = args[0] || path.resolve(__dirname, "../../..");

    // Validate that the path exists
    if (!fs.existsSync(rootPath)) {
        console.error(`Error: Path does not exist: ${rootPath}`);
        process.exit(1);
    }

    // Check if it's a directory
    const stats = fs.statSync(rootPath);
    if (!stats.isDirectory()) {
        console.error(`Error: Path is not a directory: ${rootPath}`);
        process.exit(1);
    }

    console.log(`Generating debug documentation for: ${rootPath}`);
    generateDebugDoc(rootPath);
}

// Run the main function
main();
