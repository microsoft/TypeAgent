// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Grammar Pattern Quality Audit Script
 *
 * This script analyzes static grammar patterns from PowerShell agent
 * and identifies potential quality issues and collision risks.
 *
 * Usage:
 *   npx tsx scripts/auditGrammarPatterns.mts [--namespace <name>] [--detailed]
 *
 * Options:
 *   --namespace <name>   Audit only the specified namespace (e.g., files, processes)
 *   --detailed           Show full pattern analysis with recommendations
 *   --collision-check    Check for potential collisions with common terms
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { glob } from "glob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, "..", "src");

interface PatternInfo {
    namespace: string;
    action: string;
    pattern: string;
    lineNumber: number;
}

interface AuditResult {
    patterns: PatternInfo[];
    issues: {
        pattern: PatternInfo;
        severity: "high" | "medium" | "low";
        issue: string;
        suggestion?: string;
    }[];
    collisionRisks: {
        term: string;
        patterns: PatternInfo[];
    }[];
}

// Common terms that might collide with other agents
const COLLISION_TERMS = [
    "play",
    "start",
    "stop",
    "pause",
    "resume",
    "search",
    "find",
    "list",
    "show",
    "display",
    "open",
    "close",
    "navigate",
    "go to",
    "click",
    "scroll",
    "select",
    "type",
    "read",
    "write",
    "save",
    "load",
];

function extractPatternsFromAGR(
    filePath: string,
    namespace: string,
): PatternInfo[] {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.split("\n");
    const patterns: PatternInfo[] = [];

    let currentAction: string | null = null;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Detect action definition (e.g., <ListFiles> =)
        const actionMatch = line.match(/^<(\w+)>\s*=/);
        if (actionMatch) {
            currentAction = actionMatch[1];
            continue;
        }

        // End action block when we hit another action definition or empty section
        if (line.startsWith("<") && !line.includes("->")) {
            currentAction = null;
        }

        if (currentAction) {
            // Check if next line has arrow (pattern spans two lines)
            const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";

            // Pattern is current line if it doesn't have -> and next line does
            // OR pattern is on same line as ->
            if (nextLine.startsWith("->") && !line.includes("->")) {
                // Pattern on one line, arrow on next
                const pattern = line.replace(/^\|\s*/, "").trim();
                if (
                    pattern &&
                    !pattern.startsWith("//") &&
                    !pattern.startsWith("import")
                ) {
                    patterns.push({
                        namespace,
                        action: currentAction,
                        pattern,
                        lineNumber: i + 1,
                    });
                }
            } else if (line.includes("->")) {
                // Pattern and arrow on same line
                const patternMatch = line.match(/^[|\s]*(.+?)\s*->/);
                if (patternMatch) {
                    const pattern = patternMatch[1].trim();
                    if (pattern && !pattern.startsWith("//")) {
                        patterns.push({
                            namespace,
                            action: currentAction,
                            pattern,
                            lineNumber: i + 1,
                        });
                    }
                }
            }
        }
    }

    return patterns;
}

function analyzePattern(pattern: PatternInfo): {
    severity: "high" | "medium" | "low";
    issue: string;
    suggestion?: string;
}[] {
    const issues: {
        severity: "high" | "medium" | "low";
        issue: string;
        suggestion?: string;
    }[] = [];
    const p = pattern.pattern.toLowerCase();

    // Check for overly terse patterns (1-2 characters)
    if (pattern.pattern.length <= 2 && !pattern.pattern.includes("$")) {
        issues.push({
            severity: "high",
            issue: "Pattern too terse - highly ambiguous",
            suggestion: "Add context or use multi-word pattern",
        });
    }

    // Check for poetic/literary language
    const poeticTerms = [
        "summon",
        "conjure",
        "behold",
        "peruse",
        "traverse",
        "manifest",
    ];
    for (const term of poeticTerms) {
        if (p.includes(term)) {
            issues.push({
                severity: "medium",
                issue: `Contains poetic/literary term: "${term}"`,
                suggestion:
                    "Use common vernacular (e.g., 'show', 'get', 'list')",
            });
        }
    }

    // Check for embedded scenario context
    const scenarioTerms = ["urgent", "quickly", "immediately", "please"];
    for (const term of scenarioTerms) {
        if (p.includes(term)) {
            issues.push({
                severity: "low",
                issue: `Contains embedded scenario context: "${term}"`,
                suggestion: "Remove context - handle via phrase-set matchers",
            });
        }
    }

    // Check for very long patterns (> 100 chars)
    if (pattern.pattern.length > 100) {
        issues.push({
            severity: "medium",
            issue: "Pattern very long - may be overspecified",
            suggestion: "Consider breaking into multiple patterns",
        });
    }

    // Check for missing common verbs in file operations
    if (pattern.namespace === "files" && pattern.action === "listFiles") {
        const hasCommonVerb = ["list", "show", "display", "ls", "dir"].some(
            (v) => p.includes(v),
        );
        if (!hasCommonVerb) {
            issues.push({
                severity: "medium",
                issue: "Missing common list verb",
                suggestion: "Add 'list', 'show', or 'display'",
            });
        }
    }

    return issues;
}

function checkCollisionRisks(
    patterns: PatternInfo[],
): { term: string; patterns: PatternInfo[] }[] {
    const collisionMap = new Map<string, PatternInfo[]>();

    for (const pattern of patterns) {
        const p = pattern.pattern.toLowerCase();
        for (const term of COLLISION_TERMS) {
            // Check if pattern starts with the collision term
            const regex = new RegExp(`^\\(?${term}\\b`, "i");
            if (regex.test(p)) {
                if (!collisionMap.has(term)) {
                    collisionMap.set(term, []);
                }
                collisionMap.get(term)!.push(pattern);
            }
        }
    }

    return Array.from(collisionMap.entries()).map(([term, patterns]) => ({
        term,
        patterns,
    }));
}

async function auditNamespace(
    namespace: string,
    detailed: boolean,
): Promise<AuditResult> {
    const schemaPath =
        namespace === "powershell"
            ? join(srcDir, "powershellSchema.agr")
            : join(srcDir, "namespaces", namespace, `${namespace}Schema.agr`);

    console.log(`\nAuditing ${namespace} namespace: ${schemaPath}`);

    const patterns = extractPatternsFromAGR(schemaPath, namespace);
    console.log(`  Found ${patterns.length} patterns`);

    const issues: AuditResult["issues"] = [];
    for (const pattern of patterns) {
        const patternIssues = analyzePattern(pattern);
        issues.push(...patternIssues.map((i) => ({ pattern, ...i })));
    }

    const collisionRisks = checkCollisionRisks(patterns);

    return { patterns, issues, collisionRisks };
}

async function main() {
    const args = process.argv.slice(2);
    const namespaceFilter = args.includes("--namespace")
        ? args[args.indexOf("--namespace") + 1]
        : null;
    const detailed = args.includes("--detailed");
    const collisionCheck = args.includes("--collision-check");

    console.log("=".repeat(60));
    console.log("PowerShell Grammar Pattern Quality Audit");
    console.log("=".repeat(60));

    const namespaces = namespaceFilter
        ? [namespaceFilter]
        : [
              "files",
              "processes",
              "services",
              "system",
              "network",
              "data",
              "archives",
          ];

    const allResults: AuditResult[] = [];

    for (const ns of namespaces) {
        try {
            const result = await auditNamespace(ns, detailed);
            allResults.push(result);

            // Print summary
            console.log(`\n  Summary for ${ns}:`);
            console.log(`    Total patterns: ${result.patterns.length}`);
            console.log(`    Issues found: ${result.issues.length}`);
            console.log(
                `      High: ${result.issues.filter((i) => i.severity === "high").length}`,
            );
            console.log(
                `      Medium: ${result.issues.filter((i) => i.severity === "medium").length}`,
            );
            console.log(
                `      Low: ${result.issues.filter((i) => i.severity === "low").length}`,
            );

            if (detailed && result.issues.length > 0) {
                console.log(`\n  Issues:`);
                for (const issue of result.issues) {
                    console.log(
                        `    [${issue.severity.toUpperCase()}] Line ${issue.pattern.lineNumber}: ${issue.pattern.pattern}`,
                    );
                    console.log(`      ${issue.issue}`);
                    if (issue.suggestion) {
                        console.log(`      Suggestion: ${issue.suggestion}`);
                    }
                }
            }
        } catch (err) {
            console.error(`  Error auditing ${ns}: ${err}`);
        }
    }

    // Overall statistics
    const totalPatterns = allResults.reduce(
        (sum, r) => sum + r.patterns.length,
        0,
    );
    const totalIssues = allResults.reduce((sum, r) => sum + r.issues.length, 0);
    const highSeverity = allResults.reduce(
        (sum, r) => sum + r.issues.filter((i) => i.severity === "high").length,
        0,
    );
    const mediumSeverity = allResults.reduce(
        (sum, r) =>
            sum + r.issues.filter((i) => i.severity === "medium").length,
        0,
    );
    const lowSeverity = allResults.reduce(
        (sum, r) => sum + r.issues.filter((i) => i.severity === "low").length,
        0,
    );

    console.log("\n" + "=".repeat(60));
    console.log("OVERALL AUDIT SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total patterns analyzed: ${totalPatterns}`);
    console.log(`Total issues found: ${totalIssues}`);
    console.log(`  High severity: ${highSeverity}`);
    console.log(`  Medium severity: ${mediumSeverity}`);
    console.log(`  Low severity: ${lowSeverity}`);
    console.log(
        `\nQuality score: ${(((totalPatterns - totalIssues) / totalPatterns) * 100).toFixed(1)}%`,
    );

    // Collision risk report
    if (collisionCheck) {
        console.log("\n" + "=".repeat(60));
        console.log("COLLISION RISK ANALYSIS");
        console.log("=".repeat(60));

        const allCollisions = allResults.flatMap((r) => r.collisionRisks);
        const collisionByTerm = new Map<string, PatternInfo[]>();

        for (const { term, patterns } of allCollisions) {
            if (!collisionByTerm.has(term)) {
                collisionByTerm.set(term, []);
            }
            collisionByTerm.get(term)!.push(...patterns);
        }

        for (const [term, patterns] of collisionByTerm.entries()) {
            console.log(
                `\n  "${term}" - ${patterns.length} patterns (may collide with browser/player)`,
            );
            if (detailed) {
                for (const p of patterns) {
                    console.log(`    ${p.namespace}/${p.action}: ${p.pattern}`);
                }
            }
        }
    }

    console.log("\n" + "=".repeat(60));
}

main().catch(console.error);
