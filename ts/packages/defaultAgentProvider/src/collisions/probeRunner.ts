// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

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
// Usage (from ts/, after building):
//   node packages/defaultAgentProvider/dist/collisions/probeRunner.js

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { createDispatcher } from "agent-dispatcher";
import { getInstanceDir } from "agent-dispatcher/helpers/data";
import {
    getDefaultAppAgentProviders,
    getDefaultConstructionProvider,
    getIndexingServiceRegistry,
} from "../index.js";
import type { DisplayContent, MessageContent } from "@typeagent/agent-sdk";
import type { IAgentMessage } from "agent-dispatcher";
import { silentClientIO } from "./silentClientIO.js";

// --- Probe phrases ----------------------------------------------------------

interface Probe {
    phrase: string;
    expected?: string;
}

const PROBES: Probe[] = [
    // Cluster 1 — 7 members, "toggle developer mode" cluster
    { phrase: "toggle developer mode", expected: "config.toggleDeveloperMode" },
    { phrase: "turn on wifi", expected: "desktop.EnableWifi" },
    {
        phrase: "lock screen rotation",
        expected: "desktop-display.RotationLock",
    },
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

/** Walk a DisplayContent message and return any text alternate. The probe
 * handler emits HTML with a text alternate; the text version is what we want
 * here. */
function extractText(message: DisplayContent): string {
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.join("\n");
    if (!message || typeof message !== "object") return "";
    const m = message as {
        type?: string;
        content?: MessageContent;
        alternates?: { type: string; content: MessageContent }[];
    };
    if (m.type === "text") {
        return Array.isArray(m.content)
            ? m.content.join("\n")
            : String(m.content);
    }
    if (m.alternates) {
        for (const alt of m.alternates) {
            if (alt.type === "text") {
                return Array.isArray(alt.content)
                    ? alt.content.join("\n")
                    : String(alt.content);
            }
        }
    }
    if (typeof m.content === "string") return m.content;
    return "";
}

let captured: string[] = [];

const captureClientIO = silentClientIO({
    setDisplay(msg: IAgentMessage) {
        const text = extractText(msg.message);
        if (text) captured.push(text);
    },
    appendDisplay(msg: IAgentMessage) {
        const text = extractText(msg.message);
        if (text) captured.push(text);
    },
});

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

    try {
        for (const probe of PROBES) {
            // Always pass --include-inactive: the dispatcher we spun up has
            // most agents inactive by default (no real session state), so
            // without this flag the probe filters out the very actions we want
            // to test.
            const cmd = probe.expected
                ? `@collision probe "${probe.phrase}" -e ${probe.expected} --include-inactive`
                : `@collision probe "${probe.phrase}" --include-inactive`;

            captured = [];
            try {
                await dispatcher.processCommand(cmd);
            } catch (err) {
                process.stdout.write(
                    `[ERROR for "${probe.phrase}"]: ${err instanceof Error ? err.message : String(err)}\n\n`,
                );
                continue;
            }

            const allText =
                captured.join("\n").trim() || "(no output captured)";
            process.stdout.write("=".repeat(72) + "\n");
            process.stdout.write(`PROBE: ${probe.phrase}\n`);
            if (probe.expected) {
                process.stdout.write(`EXPECTED: ${probe.expected}\n`);
            }
            process.stdout.write("\n" + allText + "\n\n");
        }
        process.stderr.write(`\nDone. ${PROBES.length} probe(s) run.\n`);
    } finally {
        await dispatcher.close();
    }
}

main().catch((err) => {
    process.stderr.write(
        `probe-runner failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
});
