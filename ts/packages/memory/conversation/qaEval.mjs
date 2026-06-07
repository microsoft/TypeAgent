// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Ad-hoc evaluation harness: import + index two real AI coding sessions, then
// ask 5 questions of each and print the answers.
//
// Importing test-lib triggers loadConfigSync() (see testLib/src/models.ts),
// which populates process.env with model credentials for aiclient.
import "test-lib";
import * as cm from "./dist/index.js";

const CLAUDE = process.env.CLAUDE_SESSION;
const COPILOT = process.env.COPILOT_SESSION;

const claudeQuestions = [
    "What is the main task the user asked for in this session?",
    "How did the user want their TypeAgent contributions divided by time period?",
    "What type of document did the user want written about their contributions?",
    "How did the user want the impact of their PRs framed?",
    "What is a Microsoft Connect performance report?",
];

const copilotQuestions = [
    "Which package was being cleaned up in this session?",
    "What was the shell's chat interface migrated to?",
    "What did the user ask to do with the changes after the cleanup?",
    "What is the name of the shared UI package used by the shell?",
    "Why was the shell package being cleaned up?",
];

function hr(title) {
    console.log("\n" + "=".repeat(70));
    console.log(title);
    console.log("=".repeat(70));
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(promise, ms, label) {
    let timer;
    const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${ms}ms`)),
            ms,
        );
    });
    try {
        return await Promise.race([promise, timeoutPromise]);
    } finally {
        clearTimeout(timer);
    }
}

async function getAnswerWithRetry(mem, question, retries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            if (attempt > 0) {
                // Brief backoff to let transient network issues clear.
                await delay(1500 * attempt);
            }
            return await withTimeout(
                mem.getAnswerFromLanguage(question),
                90000,
                "getAnswerFromLanguage",
            );
        } catch (e) {
            lastError = e;
            if (attempt < retries) {
                console.log(
                    `  [RETRY] attempt ${attempt + 1}/${retries + 1} failed: ${e?.message ?? e}`,
                );
            }
        }
    }
    throw lastError;
}

async function evalSession(label, mem, questions) {
    hr(label);
    console.log(
        `messages=${mem.messages.length}  semanticRefs=${mem.semanticRefs.length}`,
    );
    console.log(`tags=${JSON.stringify(mem.tags)}`);
    for (const q of questions) {
        console.log("\n--------------------------------------------------");
        console.log(`Q: ${q}`);
        try {
            const r = await getAnswerWithRetry(mem, q);
            if (!r.success) {
                console.log(`  [ERROR] ${r.message}`);
                continue;
            }
            for (const [, ans] of r.data) {
                console.log(`  type=${ans.type}`);
                const text = ans.answer ?? ans.whyNoAnswer ?? "(none)";
                console.log(`  A: ${text}`);
            }
        } catch (e) {
            console.log(`  [THROW] ${e?.message ?? e}`);
        }
    }
}

async function main() {
    if (!CLAUDE || !COPILOT) {
        console.error(
            "Set CLAUDE_SESSION and COPILOT_SESSION env vars to transcript paths.",
        );
        process.exit(2);
    }
    const opts = {
        includeReasoning: true,
        includeToolCalls: true,
        buildIndex: true,
    };

    console.log(`Indexing Claude session: ${CLAUDE}`);
    const t0 = Date.now();
    const claude = await cm.importClaudeSession(CLAUDE, {
        ...opts,
        name: "claude-eval",
    });
    console.log(`  indexed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    await evalSession("CLAUDE SESSION", claude, claudeQuestions);

    console.log(`\nIndexing Copilot session: ${COPILOT}`);
    const t1 = Date.now();
    const copilot = await cm.importCopilotSession(COPILOT, {
        ...opts,
        name: "copilot-eval",
    });
    console.log(`  indexed in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    await evalSession("COPILOT SESSION", copilot, copilotQuestions);
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("\nFATAL:", e?.stack ?? e);
        process.exit(1);
    });
