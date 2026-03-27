/**
 * Quick test: verify WebFlow dynamic grammar registration.
 *
 * Usage: npx tsx test-webflow-grammar.mts
 *
 * This creates a dispatcher with webFlows enabled and tests
 * whether sample flows are grammar-matchable.
 */

import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, rmSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = join(__dirname, "..", "..", ".env");
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx < 0) continue;
        const key = trimmed.substring(0, eqIdx).trim();
        let val = trimmed.substring(eqIdx + 1).trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) {
            process.env[key] = val;
        }
    }
}

async function main() {
    const tsRoot = join(__dirname, "..", "..", "..", "..");
    const dispatcherPath = join(
        tsRoot,
        "packages",
        "dispatcher",
        "dispatcher",
        "dist",
        "index.js",
    );
    const providerPath = join(
        tsRoot,
        "packages",
        "defaultAgentProvider",
        "dist",
        "defaultAgentProviders.js",
    );
    const nodeProvidersPath = join(
        tsRoot,
        "packages",
        "dispatcher",
        "nodeProviders",
        "dist",
        "index.js",
    );

    const { createDispatcher } = await import(
        "file://" + dispatcherPath.replace(/\\/g, "/")
    );
    const { getDefaultAppAgentProviders } = await import(
        "file://" + providerPath.replace(/\\/g, "/")
    );
    const { getFsStorageProvider } = await import(
        "file://" + nodeProvidersPath.replace(/\\/g, "/")
    );

    const persistDir = join(process.env.TEMP ?? "/tmp", "webflow-grammar-test");
    if (existsSync(persistDir)) {
        rmSync(persistDir, { recursive: true, force: true });
    }

    console.log("Creating dispatcher...");
    const dispatcher = await createDispatcher("webflow-test", {
        appAgentProviders: getDefaultAppAgentProviders(undefined),
        agents: { actions: true, commands: true },
        execution: { history: false },
        collectCommandResult: true,
        portBase: 9400,
        persistDir,
        storageProvider: getFsStorageProvider(),
    });

    console.log("Dispatcher created.");

    // Inspect dispatcher state
    try {
        const schemas = await dispatcher.getActiveSchemas();
        console.log(`Active schemas: ${schemas.join(", ")}`);
    } catch (e) {
        console.log("Could not get active schemas:", e);
    }

    // Wait for async initialization to fully complete
    // The browser agent's updateAgentContext seeds sample flows asynchronously
    console.log("Waiting for initialization to complete...");
    await new Promise((r) => setTimeout(r, 5000));

    // Force reload schema to pick up grammar after seeding
    try {
        await dispatcher.processCommand("@config agent browser.webFlows");
        console.log("Reloaded browser.webFlows schema");
    } catch (e) {
        // Ignore — just used to trigger schema reload
    }

    // Check if WebFlowStore has flows
    try {
        const storePath = join(
            persistDir,
            "browser",
            "registry",
            "webflow-index.json",
        );
        if (existsSync(storePath)) {
            const index = JSON.parse(readFileSync(storePath, "utf-8"));
            const flowNames = Object.keys(index.flows ?? {});
            console.log(
                `WebFlowStore has ${flowNames.length} flows: ${flowNames.join(", ")}`,
            );
            // Check grammar text on first flow
            const first = index.flows[flowNames[0]];
            if (first?.grammarRuleText) {
                console.log(
                    `Grammar text (first): ${first.grammarRuleText.substring(0, 100)}...`,
                );
            } else {
                console.log("No grammarRuleText on first flow entry");
            }
        } else {
            console.log("WebFlowStore index not found at:", storePath);
        }
    } catch (e) {
        console.log("Error checking store:", e);
    }

    console.log("\nTesting grammar matching...\n");

    const testUtterances = [
        "search for headphones",
        "add laptop to cart",
        "view my shopping cart",
        "find nearby store",
        "navigate to settings page",
        "list web flows",
    ];

    for (const utterance of testUtterances) {
        try {
            const result = await dispatcher.processCommand(utterance);
            const actions = (result as any)?.actions ?? [];
            const firstAction = actions[0];
            const schema = firstAction?.schemaName ?? "none";
            const action = firstAction?.actionName ?? "none";
            const params = firstAction?.parameters
                ? JSON.stringify(firstAction.parameters)
                : "{}";

            const isWebFlow =
                schema === "browser.webFlows" ||
                schema.includes("webflow") ||
                schema.includes("browser");
            const marker = isWebFlow ? "✓ WEBFLOW" : "  other";

            console.log(
                `${marker} | "${utterance}" → ${schema}.${action} ${params}`,
            );
        } catch (err) {
            console.log(`  ERROR | "${utterance}" → ${err}`);
        }
    }

    console.log("\nDone. Closing dispatcher...");
    await dispatcher.close();
}

main().catch((err) => {
    console.error("Test failed:", err);
    process.exit(1);
});
