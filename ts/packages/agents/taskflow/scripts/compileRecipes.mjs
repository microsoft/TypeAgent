// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Deterministic recipe compiler — no Claude reasoning needed.
 *
 * Reads pending/*.recipe.json and generates:
 *   - flows/ACTION_NAME.flow.json
 *   - TypeScript type appended to src/schema/userActions.mts
 *   - Grammar rule appended to src/taskflowSchema.agr
 *   - manifest.json flows entry
 *
 * Then runs: pnpm run asc && pnpm run agc && npx tsc -b
 */

import {
    readFileSync,
    writeFileSync,
    readdirSync,
    mkdirSync,
    renameSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG = join(__dirname, "..");

// ── Helpers ───────────────────────────────────────────────────────────────────

function toPascalCase(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Extract $(varName:type) capture names from a grammar pattern string. */
function extractCaptures(pattern) {
    const captures = [];
    const re = /\$\((\w+):\w+\)/g;
    let m;
    while ((m = re.exec(pattern)) !== null) {
        if (!captures.includes(m[1])) captures.push(m[1]);
    }
    return captures;
}

/** Build the -> { ... } action body for a grammar pattern. */
function buildActionBody(actionName, captures) {
    if (captures.length === 0) {
        return `-> { actionName: "${actionName}", parameters: {} }`;
    }
    return `-> { actionName: "${actionName}", parameters: { ${captures.join(", ")} } }`;
}

/** Build a complete .agr grammar rule from a recipe. */
function buildGrammarRule(recipe) {
    const { actionName, grammarPatterns } = recipe;
    const alternatives = grammarPatterns.map((pattern) => {
        const captures = extractCaptures(pattern);
        const body = buildActionBody(actionName, captures);
        return `    ${pattern}\n      ${body}`;
    });
    return `\n<${actionName}> =\n${alternatives.join("\n  | ")};\n`;
}

/** Build the TypeScript type declaration for a recipe. */
function buildTsType(recipe) {
    const typeName = toPascalCase(recipe.actionName) + "Action";
    const params = recipe.parameters || [];

    if (params.length === 0) {
        return `\n// ${recipe.description}\nexport type ${typeName} = {\n    actionName: "${recipe.actionName}";\n};`;
    }

    const paramLines = params
        .map((p) => {
            const opt = p.required === false ? "?" : "";
            const comment = p.description
                ? `        // ${p.description}\n`
                : "";
            return `${comment}        ${p.name}${opt}: ${p.type};`;
        })
        .join("\n");

    return `\n// ${recipe.description}\nexport type ${typeName} = {\n    actionName: "${recipe.actionName}";\n    parameters: {\n${paramLines}\n    };\n};`;
}

/** Build the flow.json object from a recipe. */
function buildFlowJson(recipe) {
    const params = {};
    for (const p of recipe.parameters || []) {
        const def = { type: p.type };
        if (p.required !== undefined) def.required = p.required;
        if (p.default !== undefined) def.default = p.default;
        if (p.description) def.description = p.description;
        params[p.name] = def;
    }
    return {
        name: recipe.actionName,
        description: recipe.description,
        parameters: params,
        steps: recipe.steps,
    };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const pendingDir = join(PKG, "pending");
const processedDir = join(PKG, "pending", "processed");
const flowsDir = join(PKG, "flows");

mkdirSync(processedDir, { recursive: true });
mkdirSync(flowsDir, { recursive: true });

const recipeFiles = readdirSync(pendingDir).filter((f) =>
    f.endsWith(".recipe.json"),
);

if (recipeFiles.length === 0) {
    console.log("No pending recipes found.");
    process.exit(0);
}

let anyCompiled = false;

for (const recipeFile of recipeFiles) {
    const recipePath = join(pendingDir, recipeFile);
    const recipe = JSON.parse(readFileSync(recipePath, "utf8"));
    console.log(`\nCompiling: ${recipe.actionName}`);

    // 1. Write flow.json
    const flowPath = join(flowsDir, `${recipe.actionName}.flow.json`);
    writeFileSync(
        flowPath,
        JSON.stringify(buildFlowJson(recipe), null, 2) + "\n",
    );
    console.log(`  ✓ flows/${recipe.actionName}.flow.json`);

    // 2. Append TypeScript type and update union in userActions.mts
    const schemaPath = join(PKG, "src", "schema", "userActions.mts");
    let schema = readFileSync(schemaPath, "utf8");
    const typeName = toPascalCase(recipe.actionName) + "Action";

    if (schema.includes(`actionName: "${recipe.actionName}"`)) {
        console.log(
            `  ⚠ Type for '${recipe.actionName}' already exists — skipping`,
        );
    } else {
        const tsType = buildTsType(recipe);
        // Insert new type before the TaskFlowActions union
        schema = schema.replace(
            /\nexport type TaskFlowActions =/,
            `${tsType}\n\nexport type TaskFlowActions =`,
        );
        // Append new member to the union (insert before closing ;)
        const unionStart = schema.indexOf("export type TaskFlowActions =");
        const unionEnd = schema.indexOf(";", unionStart);
        const before = schema.substring(0, unionEnd);
        const after = schema.substring(unionEnd);
        schema = `${before}\n    | ${typeName}${after}`;
        writeFileSync(schemaPath, schema);
        console.log(`  ✓ src/schema/userActions.mts (added ${typeName})`);
    }

    // 3. Update grammar: add to <Start> and append rule
    const grammarPath = join(PKG, "src", "taskflowSchema.agr");
    let grammar = readFileSync(grammarPath, "utf8");

    if (grammar.includes(`<${recipe.actionName}>`)) {
        console.log(
            `  ⚠ Grammar rule '<${recipe.actionName}>' already exists — skipping`,
        );
    } else {
        // Add to <Start> rule (replace the closing ; of the Start rule)
        grammar = grammar.replace(
            /(<Start>\s*=[^;]+)(;)/,
            `$1 | <${recipe.actionName}>$2`,
        );
        grammar += buildGrammarRule(recipe);
        writeFileSync(grammarPath, grammar);
        console.log(
            `  ✓ src/taskflowSchema.agr (added <${recipe.actionName}>)`,
        );
    }

    // 4. Update manifest.json flows
    const manifestPath = join(PKG, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.flows) manifest.flows = {};
    if (manifest.flows[recipe.actionName]) {
        console.log(
            `  ⚠ manifest.json entry for '${recipe.actionName}' already exists — skipping`,
        );
    } else {
        manifest.flows[recipe.actionName] =
            `./flows/${recipe.actionName}.flow.json`;
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
        console.log(`  ✓ manifest.json (added flows.${recipe.actionName})`);
    }

    // 5. Move recipe to processed/
    renameSync(recipePath, join(processedDir, recipeFile));
    console.log(`  ✓ moved to pending/processed/`);

    anyCompiled = true;
}

if (anyCompiled) {
    console.log("\nRunning build...");
    try {
        execSync("pnpm run asc && pnpm run agc && npx tsc -b", {
            cwd: PKG,
            stdio: "inherit",
        });
        console.log("\n✓ Build complete. New flows are ready.");
    } catch {
        console.error("\n✗ Build failed — check errors above.");
        process.exit(1);
    }
}
