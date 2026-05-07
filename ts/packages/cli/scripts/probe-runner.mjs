// Standalone probe runner: spins up the dispatcher with the default agent
// providers, runs `@collision probe "<phrase>"` for each phrase in the
// PROBES list, and prints the captured text output.
//
// SAFETY: this dispatcher instance never executes actions —
//   - `agents.actions: false`        disables every agent's executeAction
//   - `cache.enabled: false`          no cache reads/writes
//   - `translation.enabled: false`    no LLM translation runs
//   - `explainer.enabled: false`      no explanation runs
//   - we only invoke `@collision probe`, which queries the embedding map
//     and never produces an action
// Run while you're using your computer; nothing here will click anywhere.
//
// Usage (from repo root, ts/):
//   node packages/cli/scripts/probe-runner.mjs

import { config as loadDotenv } from "dotenv";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// Load ts/.env (relative to this script: ../../../.env from packages/cli/scripts/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoTsRoot = path.resolve(__dirname, "../../..");
loadDotenv({ path: path.join(repoTsRoot, ".env") });

import { createDispatcher } from "agent-dispatcher";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "default-agent-provider";
import { getInstanceDir } from "agent-dispatcher/helpers/data";

// --- Probe phrases ----------------------------------------------------------

const PROBES = [
    // Cluster 1 — 7 members, "toggle developer mode" cluster
    { phrase: "toggle developer mode", expected: "config.toggleDeveloperMode" },
    { phrase: "turn on wifi", expected: "desktop.EnableWifi" },
    { phrase: "lock screen rotation", expected: "desktop-display.RotationLock" },
    { phrase: "enable the touchpad", expected: "desktop-input.EnableTouchPad" },
    {
        phrase: "enable transparency effects",
        expected: "desktop-personalization.EnableTransparency",
    },
    {
        phrase: "enable automatic daylight saving time",
        expected: "desktop-system.AutomaticDSTAdjustment",
    },
    {
        phrase: "show seconds in the system clock",
        expected: "desktop-taskbar.DisplaySecondsInSystrayClock",
    },

    // Cluster 5 — 5 members, "toggle explanation" cluster
    { phrase: "toggle the explanation", expected: "config.toggleExplanation" },
    { phrase: "turn on airplane mode", expected: "desktop.ToggleAirplaneMode" },
    {
        phrase: "show taskbar on all monitors",
        expected: "desktop-taskbar.DisplayTaskbarOnAllMonitors",
    },
    {
        phrase: "enhance pointer precision",
        expected: "desktop-input.EnhancePointerPrecision",
    },
    {
        phrase: "enable filter keys",
        expected: "desktop-system.EnableFilterKeysAction",
    },

    // Bonus — deliberately ambiguous, no expected target
    { phrase: "turn it on" },
    { phrase: "enable it" },
    { phrase: "toggle the setting" },
];

// --- Output capture ---------------------------------------------------------

/**
 * Walk a DisplayContent message and return any text alternate.  The
 * probe handler emits HTML with a text alternate; the text version is
 * what's useful here.
 */
function extractText(message) {
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join("\n");
    if (!message || typeof message !== "object") return "";
    if (message.type === "text") {
        return Array.isArray(message.content)
            ? message.content.join("\n")
            : String(message.content);
    }
    if (message.alternates) {
        for (const alt of message.alternates) {
            if (alt.type === "text") {
                return Array.isArray(alt.content)
                    ? alt.content.join("\n")
                    : String(alt.content);
            }
        }
    }
    if (typeof message.content === "string") return message.content;
    return "";
}

// Buffer of text fragments captured from the most recent processCommand call.
let captured = [];

const noop = () => {};
const noopAsync = async () => {};

const captureClientIO = {
    clear: noop,
    exit: noop,
    shutdown: noop,
    setUserRequest: noop,
    setDisplayInfo: noop,
    setDisplay(msg) {
        const text = extractText(msg.message);
        if (text) captured.push(text);
    },
    appendDisplay(msg) {
        const text = extractText(msg.message);
        if (text) captured.push(text);
    },
    appendDiagnosticData: noop,
    setDynamicDisplay: noop,
    question: async () => 0,
    proposeAction: async () => undefined,
    notify: noop,
    openLocalView: noopAsync,
    closeLocalView: noopAsync,
    requestChoice: noop,
    requestInteraction: noop,
    interactionResolved: noop,
    interactionCancelled: noop,
    takeAction: noop,
};

// --- Run --------------------------------------------------------------------

async function main() {
    const instanceDir = getInstanceDir();
    const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
    const defaultConstructionProvider = getDefaultConstructionProvider();
    const indexingServiceRegistry =
        await getIndexingServiceRegistry(instanceDir);

    process.stderr.write(
        "Spinning up dispatcher (read-only — no actions / translation / cache)…\n",
    );
    const dispatcher = await createDispatcher("probe-runner", {
        appAgentProviders: defaultAppAgentProviders,
        agents: { actions: false, commands: ["dispatcher"] },
        translation: { enabled: false },
        explainer: { enabled: false },
        cache: { enabled: false },
        constructionProvider: defaultConstructionProvider,
        indexingServiceRegistry,
        clientIO: captureClientIO,
    });
    process.stderr.write("Dispatcher ready.\n\n");

    for (const probe of PROBES) {
        // Always pass --include-inactive: the dispatcher we spun up has most
        // agents inactive by default (no real session state), so without
        // this flag the probe filters out the very actions we want to test.
        const cmd = probe.expected
            ? `@collision probe "${probe.phrase}" -e ${probe.expected} --include-inactive`
            : `@collision probe "${probe.phrase}" --include-inactive`;

        captured = [];
        try {
            await dispatcher.processCommand(cmd);
        } catch (err) {
            process.stdout.write(
                `[ERROR for "${probe.phrase}"]: ${err?.message ?? err}\n\n`,
            );
            continue;
        }

        const allText = captured.join("\n").trim() || "(no output captured)";
        process.stdout.write("=".repeat(72) + "\n");
        process.stdout.write(`PROBE: ${probe.phrase}\n`);
        if (probe.expected) {
            process.stdout.write(`EXPECTED: ${probe.expected}\n`);
        }
        process.stdout.write("\n" + allText + "\n\n");
    }

    await dispatcher.close();
    process.stderr.write(`\nDone. ${PROBES.length} probe(s) run.\n`);
}

main().catch((err) => {
    process.stderr.write(`probe-runner failed: ${err?.stack ?? err}\n`);
    process.exit(1);
});
