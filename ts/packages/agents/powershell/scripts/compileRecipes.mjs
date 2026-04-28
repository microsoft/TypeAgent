// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * PowerShell recipe compiler — reads pending/*.recipe.json and generates:
 *   - flows/ACTION_NAME.flow.json (with script step type)
 *   - TypeScript type appended to src/schema/scriptActions.mts
 *   - Grammar rule appended to src/powershellSchema.agr
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

/** Build AGR grammar rules from a script recipe. */
function buildGrammarRules(recipe) {
    const { actionName, grammarPatterns } = recipe;
    const rules = [];

    grammarPatterns.forEach((gp, index) => {
        const pattern = typeof gp === "string" ? gp : gp.pattern;
        const isAlias = typeof gp === "object" && gp.isAlias;
        const captures = extractCaptures(pattern);
        const body = buildActionBody(actionName, captures);

        const ruleName =
            index === 0 ? actionName : `${actionName}Alias${index}`;

        rules.push(
            `\n<${ruleName}> [spacing=optional] =\n    ${pattern}\n      ${body};\n`,
        );
    });

    return rules;
}

/** Build the TypeScript type declaration for a script recipe. */
function buildTsType(recipe) {
    const typeName = toPascalCase(recipe.actionName) + "Action";
    const params = recipe.parameters || [];

    if (params.length === 0) {
        return `\n// ${recipe.description}\nexport type ${typeName} = {\n    actionName: "${recipe.actionName}";\n};`;
    }

    const paramLines = params
        .map((p) => {
            const opt = p.required === false ? "?" : "";
            const tsType = p.type === "path" ? "string" : p.type;
            const comment = p.description
                ? `        // ${p.description}\n`
                : "";
            return `${comment}        ${p.name}${opt}: ${tsType};`;
        })
        .join("\n");

    return `\n// ${recipe.description}\nexport type ${typeName} = {\n    actionName: "${recipe.actionName}";\n    parameters: {\n${paramLines}\n    };\n};`;
}

/** Build the flow.json object from a script recipe (uses script step type). */
function buildFlowJson(recipe) {
    const params = {};
    for (const p of recipe.parameters || []) {
        const def = { type: p.type === "path" ? "string" : p.type };
        if (p.required !== undefined) def.required = p.required;
        if (p.default !== undefined) def.default = p.default;
        if (p.description) def.description = p.description;
        params[p.name] = def;
    }

    // Build parameter references for the script step
    const scriptParams = {};
    for (const p of recipe.parameters || []) {
        scriptParams[toPascalCase(p.name)] = `\${${p.name}}`;
    }

    return {
        name: recipe.actionName,
        description: recipe.description,
        parameters: params,
        steps: [
            {
                id: "execute",
                type: "script",
                language: recipe.script?.language || "powershell",
                body: recipe.script?.body || "",
                parameters: scriptParams,
                sandbox: recipe.sandbox || {
                    allowedCmdlets: [],
                    allowedPaths: ["$env:USERPROFILE", "$PWD", "$env:TEMP"],
                    maxExecutionTime: 30,
                    networkAccess: false,
                },
            },
        ],
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
    console.log("No pending script recipes found.");
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

    // 2. Append TypeScript type and update union in scriptActions.mts
    const schemaPath = join(PKG, "src", "schema", "scriptActions.mts");
    let schema = readFileSync(schemaPath, "utf8");
    const typeName = toPascalCase(recipe.actionName) + "Action";

    if (schema.includes(`actionName: "${recipe.actionName}"`)) {
        console.log(
            `  ⚠ Type for '${recipe.actionName}' already exists — skipping`,
        );
    } else {
        const tsType = buildTsType(recipe);
        schema = schema.replace(
            /\nexport type PowerShellActions =/,
            `${tsType}\n\nexport type PowerShellActions =`,
        );
        const unionStart = schema.indexOf("export type PowerShellActions =");
        const unionEnd = schema.indexOf(";", unionStart);
        const before = schema.substring(0, unionEnd);
        const after = schema.substring(unionEnd);
        schema = `${before}\n    | ${typeName}${after}`;
        writeFileSync(schemaPath, schema);
        console.log(`  ✓ src/schema/scriptActions.mts (added ${typeName})`);
    }

    // 3. Update grammar: add to <Start> and append rules
    const grammarPath = join(PKG, "src", "powershellSchema.agr");
    let grammar = readFileSync(grammarPath, "utf8");

    if (grammar.includes(`<${recipe.actionName}>`)) {
        console.log(
            `  ⚠ Grammar rule '<${recipe.actionName}>' already exists — skipping`,
        );
    } else {
        const rules = buildGrammarRules(recipe);
        // Add primary rule name to <Start>
        grammar = grammar.replace(
            /(<Start>\s*=[^;]+)(;)/,
            `$1 | <${recipe.actionName}>$2`,
        );
        // Also add alias rule names to <Start>
        recipe.grammarPatterns.forEach((gp, index) => {
            if (index > 0) {
                const aliasName = `${recipe.actionName}Alias${index}`;
                grammar = grammar.replace(
                    /(<Start>\s*=[^;]+)(;)/,
                    `$1 | <${aliasName}>$2`,
                );
            }
        });
        grammar += rules.join("");
        writeFileSync(grammarPath, grammar);
        console.log(
            `  ✓ src/powershellSchema.agr (added <${recipe.actionName}>)`,
        );
    }

    // 4. Update manifest.json flows
    const manifestPath = join(PKG, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (!manifest.flows) manifest.flows = {};
    if (manifest.flows[recipe.actionName]) {
        console.log(
            `  ⚠ manifest.json entry for '${recipe.actionName}' already exists — updating`,
        );
    }
    manifest.flows[recipe.actionName] =
        `./flows/${recipe.actionName}.flow.json`;
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(`  ✓ manifest.json (added flows.${recipe.actionName})`);

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
        console.log("\n✓ Build complete. New script flows are ready.");
    } catch {
        console.error("\n✗ Build failed — check errors above.");
        process.exit(1);
    }
}
