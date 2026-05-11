// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Smoke test for the @collision corpus * handlers.
//
// Spins up a read-only dispatcher and runs `@collision corpus visualize`
// and `@collision corpus reanalyze` against an existing reclassified
// probe-results file. Confirms wiring is correct without paying for an
// LLM corpus generation.
//
// Usage (from ts/, after building):
//   node packages/defaultAgentProvider/dist/collisions/smokeTest.js

import { config as loadDotenv } from "dotenv";
loadDotenv();

import * as fs from "node:fs";
import * as path from "node:path";

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

const SOURCE_FILE = "f:/tmp/probe-results-full-reclassified.json";

const stubClientIO = silentClientIO({
    appendDisplay(message: IAgentMessage) {
        // Pull the message envelope, prefer the text alternate (or strip HTML
        // if only HTML is provided) for readable smoke-test output.
        const inner = message.message as DisplayContent;
        const obj = inner as {
            type?: string;
            content?: MessageContent;
            kind?: string;
            alternates?: { type: string; content: MessageContent }[];
        };
        const kind = obj?.kind ? `[${obj.kind}] ` : "";
        const text =
            obj?.alternates?.find?.((a) => a.type === "text")?.content ??
            (obj?.type === "text" ? obj.content : undefined) ??
            (typeof inner === "string" ? inner : undefined);
        if (Array.isArray(text)) {
            for (const line of text) process.stdout.write(kind + line + "\n");
        } else if (text) {
            process.stdout.write(kind + String(text) + "\n");
        } else if (obj?.type === "html" && typeof obj.content === "string") {
            const stripped = obj.content
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            process.stdout.write(kind + stripped.slice(0, 200) + "\n");
        }
    },
});

async function main() {
    const instanceDir = getInstanceDir();
    const defaultAppAgentProviders = getDefaultAppAgentProviders(instanceDir);
    const defaultConstructionProvider = getDefaultConstructionProvider();
    const indexingServiceRegistry = await getIndexingServiceRegistry(instanceDir);

    process.stderr.write("Spinning up read-only dispatcher…\n");
    const dispatcher = await createDispatcher("smoke-test-collision-corpus", {
        appAgentProviders: defaultAppAgentProviders,
        agents: { actions: false, commands: ["dispatcher"] },
        translation: { enabled: false },
        explainer: { enabled: false },
        cache: { enabled: false },
        constructionProvider: defaultConstructionProvider,
        indexingServiceRegistry,
        clientIO: stubClientIO,
    });

    try {
        // Use an explicit workdir so the handler doesn't need to resolve
        // `instanceDir` (which this test harness can't set without also
        // configuring a storageProvider).
        const workdir = path.join(
            process.env.TEMP || "f:/tmp",
            "collision-corpus-smoke",
        );
        fs.mkdirSync(workdir, { recursive: true });
        const inFile = path.join(workdir, "probe-results-reclassified.json");
        const outFile = path.join(workdir, "collisions-viz.html");
        if (!fs.existsSync(SOURCE_FILE)) {
            throw new Error(
                `Source data not found: ${SOURCE_FILE}. Run \`@collision corpus run\` from a real shell session first.`,
            );
        }
        process.stderr.write(`Copying ${SOURCE_FILE} -> ${inFile}\n`);
        fs.copyFileSync(SOURCE_FILE, inFile);
        if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

        process.stderr.write("\n--- @collision events (sanity) ---\n");
        await dispatcher.processCommand("@collision events");

        process.stderr.write("\n--- @collision corpus visualize ---\n");
        await dispatcher.processCommand(
            `@collision corpus visualize --workdir "${workdir}"`,
        );

        if (!fs.existsSync(outFile)) {
            throw new Error(`Output HTML not created: ${outFile}`);
        }
        const sizeKB = (fs.statSync(outFile).size / 1024).toFixed(0);
        process.stderr.write(
            `\n✓ visualize handler produced ${outFile} (${sizeKB} KB)\n`,
        );

        const html = fs.readFileSync(outFile, "utf8");
        if (!html.includes("d3.sankey")) {
            throw new Error("Output HTML missing d3-sankey reference");
        }
        if (!html.includes('"counts"')) {
            throw new Error("Output HTML missing payload counts");
        }
        process.stderr.write("✓ HTML payload + D3 references present\n");

        process.stderr.write("\n--- @collision corpus reanalyze ---\n");
        const probeIn = path.join(workdir, "probe-results.json");
        fs.copyFileSync(inFile, probeIn);
        const reclassFresh = path.join(workdir, "probe-results-reclassified.json");
        const beforeMtime = fs.statSync(reclassFresh).mtimeMs;
        await new Promise((r) => setTimeout(r, 50));
        await dispatcher.processCommand(
            `@collision corpus reanalyze --workdir "${workdir}"`,
        );
        const afterMtime = fs.statSync(reclassFresh).mtimeMs;
        if (afterMtime <= beforeMtime) {
            throw new Error("Reanalyze did not rewrite the reclassified file");
        }
        process.stderr.write("✓ reanalyze handler rewrote reclassified file\n");

        process.stderr.write("\n--- @collision corpus recovery ---\n");
        await dispatcher.processCommand(
            `@collision corpus recovery --workdir "${workdir}"`,
        );
        process.stderr.write("✓ recovery handler ran\n");

        process.stderr.write("\n--- @collision corpus visualize-recovery ---\n");
        const recoveryHtml = path.join(workdir, "recovery-viz.html");
        if (fs.existsSync(recoveryHtml)) fs.unlinkSync(recoveryHtml);
        await dispatcher.processCommand(
            `@collision corpus visualize-recovery --workdir "${workdir}"`,
        );
        if (!fs.existsSync(recoveryHtml)) {
            throw new Error(
                `Recovery HTML not created: ${recoveryHtml}`,
            );
        }
        const rsizeKB = (fs.statSync(recoveryHtml).size / 1024).toFixed(0);
        process.stderr.write(
            `✓ visualize-recovery produced ${recoveryHtml} (${rsizeKB} KB)\n`,
        );
        const rhtml = fs.readFileSync(recoveryHtml, "utf8");
        if (!rhtml.includes("sameSchema") || !rhtml.includes("perAction")) {
            throw new Error("Recovery HTML missing expected payload fields");
        }
        process.stderr.write("✓ recovery HTML payload looks well-formed\n");

        process.stderr.write(
            "\n--- @collision corpus translate (registration check) ---\n",
        );
        // Registration smoke: does NOT call the LLM. The smoke harness boots
        // with `translation: { enabled: false }`, so an actual translate run
        // would fail anyway. Pointing at a nonexistent corpus exercises the
        // command-parser registration + the missing-input warn path; if this
        // throws, either the subcommand isn't registered or its argument
        // parsing regressed. Real end-to-end runs happen by hand in a live
        // shell where translation is enabled.
        await dispatcher.processCommand(
            `@collision corpus translate --in "${path.join(workdir, "DOES-NOT-EXIST-corpus.json")}" --workdir "${workdir}"`,
        );
        process.stderr.write(
            "✓ corpus translate command registered (warn-on-missing-input path OK)\n",
        );

        process.stderr.write("\n--- @collision neighborhoods preview ---\n");
        const previewHtml = path.join(workdir, "neighborhoods-preview.html");
        if (fs.existsSync(previewHtml)) fs.unlinkSync(previewHtml);
        // The corpus probe-results-reclassified.json was already copied above
        // as `inFile`; the preview command picks it up automatically from the
        // workdir.
        await dispatcher.processCommand(
            `@collision neighborhoods preview --workdir "${workdir}" --threshold 0.78`,
        );
        if (!fs.existsSync(previewHtml)) {
            throw new Error(
                `Neighborhood preview HTML not created: ${previewHtml}`,
            );
        }
        const psizeKB = (fs.statSync(previewHtml).size / 1024).toFixed(0);
        process.stderr.write(
            `✓ neighborhoods preview produced ${previewHtml} (${psizeKB} KB)\n`,
        );
        const phtml = fs.readFileSync(previewHtml, "utf8");
        if (!phtml.includes("Ambiguity neighborhood preview")) {
            throw new Error("Preview HTML missing expected title");
        }
        if (!phtml.includes('"neighborhoods":')) {
            throw new Error("Preview HTML missing payload");
        }
        process.stderr.write("✓ preview HTML payload looks well-formed\n");

        process.stderr.write("\nAll smoke tests passed.\n");
    } finally {
        await dispatcher.close();
    }
}

main().catch((err: unknown) => {
    process.stderr.write(
        `smoke test failed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
});
