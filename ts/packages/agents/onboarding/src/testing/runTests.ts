// Quick test runner for onboarding agent tests
// Run from ts/ root: node --disable-warning=DEP0190 packages/agents/onboarding/dist/testing/runTests.js <integrationName>

import { createDispatcher } from "agent-dispatcher";
import { createNpmAppAgentProvider, getFsStorageProvider } from "dispatcher-node-providers";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";

const integrationName = process.argv[2] || "github-cli";

const __filename = fileURLToPath(import.meta.url);
const AGENTS_DIR = path.resolve(__filename, "../../../../../../packages/agents");
const WORKSPACE_DIR = path.join(os.homedir(), ".typeagent", "onboarding", integrationName);

const testCasesFile = path.join(WORKSPACE_DIR, "testing", "test-cases.json");
if (!fs.existsSync(testCasesFile)) {
    console.error(`No test cases at ${testCasesFile}`);
    process.exit(1);
}
const testCases = JSON.parse(fs.readFileSync(testCasesFile, "utf-8"));
console.log(`Loaded ${testCases.length} test cases for "${integrationName}"`);

const agentDir = path.resolve(AGENTS_DIR, integrationName);
const packageName = `${integrationName}-agent`;
const configs = { [integrationName]: { name: packageName, path: agentDir } };
const provider = createNpmAppAgentProvider(configs, import.meta.url);

const noop = () => {};
const clientIO = {
    clear: noop, exit: () => process.exit(0),
    setUserRequest: noop, setDisplayInfo: noop,
    setDisplay: noop, appendDisplay: noop,
    appendDiagnosticData: noop, setDynamicDisplay: noop,
    askYesNo: async (_id: any, _msg: any, def = false) => def,
    proposeAction: async () => undefined,
    popupQuestion: async () => { throw new Error("not supported"); },
    notify: noop, openLocalView: async () => {},
    closeLocalView: async () => {}, requestChoice: noop, takeAction: noop,
};

const instanceDir = getInstanceDir();
const tmpDir = path.join(instanceDir, "onboarding-test-tmp-" + Date.now());

// Diagnostic: check provider
console.log("Agent names from provider:", provider.getAppAgentNames());
try {
    const manifest = await provider.getAppAgentManifest(integrationName);
    console.log("Manifest loaded:", JSON.stringify({
        desc: manifest.description,
        schema: manifest.schema ? {
            schemaFile: manifest.schema.schemaFile,
            grammarFile: manifest.schema.grammarFile,
            schemaType: manifest.schema.schemaType,
        } : "NONE",
    }, null, 2));
} catch (e: any) {
    console.error("Failed to load manifest:", e.message);
}

console.log("Creating test dispatcher...");
const dispatcher = await createDispatcher("onboarding-test-runner", {
    appAgentProviders: [provider],
    agents: { schemas: [integrationName], actions: [integrationName], commands: ["dispatcher", integrationName] },
    explainer: { enabled: false },
    cache: { enabled: true },
    collectCommandResult: true,
    persistDir: tmpDir,
    storageProvider: getFsStorageProvider(),
    clientIO,
    dblogging: false,
});

console.log("Running tests...");
const results = [];
let passed = 0;
for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    try {
        const result = await dispatcher.processCommand(tc.phrase);
        const actual = result?.actions?.[0]?.actionName;
        const ok = actual === tc.expectedActionName;
        if (ok) passed++;
        results.push({
            phrase: tc.phrase,
            expectedActionName: tc.expectedActionName,
            actualActionName: actual,
            passed: ok,
            ...(ok ? {} : { error: `Expected "${tc.expectedActionName}", got "${actual ?? "none"}"` }),
        });
        if (!ok) {
            console.log(`  FAIL [${i+1}/${testCases.length}]: "${tc.phrase.substring(0,60)}" → ${actual ?? "none"} (exp: ${tc.expectedActionName})`);
        }
    } catch (err: any) {
        results.push({
            phrase: tc.phrase,
            expectedActionName: tc.expectedActionName,
            passed: false,
            error: err?.message ?? String(err),
        });
        console.log(`  ERROR [${i+1}/${testCases.length}]: "${tc.phrase.substring(0,60)}" → ${err?.message?.substring(0,80)}`);
    }
}

const failed = results.length - passed;
const passRate = Math.round((passed / results.length) * 100);
console.log(`\nResults: ${passed}/${results.length} (${passRate}%) — ${failed} failures`);

const resultFile = path.join(WORKSPACE_DIR, "testing", "results.json");
fs.writeFileSync(resultFile, JSON.stringify({
    integrationName,
    ranAt: new Date().toISOString(),
    total: results.length,
    passed,
    failed,
    results,
}, null, 2));
console.log(`Results saved to ${resultFile}`);

await dispatcher.close();
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(0);
