#!/usr/bin/env node
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadConfigSync } from "@typeagent/config";
import { Question } from "./benchmarkSchema.js";
import { allCuratedQuestions, CuratedQuestion } from "./curatedQuestions.js";
import { gradeAnswers } from "./grade.js";
import { GradedQuestion } from "./gradingSchema.js";
import { createJudgeModel } from "./models.js";
import { answerFromTranscript } from "./oracle.js";
import { generateQuestions } from "./questionGen.js";
import { RemSystem } from "./remRunner.js";
import { printReport } from "./report.js";

// Load layered TypeAgent config (config.defaults.yaml + config.local.yaml +
// .env fallback) so API settings are available before any model is created.
loadConfigSync();

const USAGE = `Usage:
  memory-eval generate --transcript <file> --out <questions.json> [--count N]
      Generate benchmark questions (with reference answers) from a transcript.

  memory-eval run --transcript <file> [options]
      Ingest the transcript into REM, answer a question set, LLM-grade the
      answers, and print a report.

      --questions <file>   Load questions from a JSON file (from 'generate').
      --curated            Include the built-in curated question set.
      --generate N         Generate N fresh questions before running.
      --maxQuestions N     Cap the number of questions processed.
      --out <file>         Write graded results to a JSON file.

  At least one question source (--questions, --curated, or --generate) is
  required for 'run'. This is a live example: API keys must be configured
  (config.local.yaml or .env).`;

type Args = Map<string, string | boolean>;

function parseArgs(argv: string[]): Args {
    const args: Args = new Map();
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i];
        if (!token.startsWith("--")) {
            continue;
        }
        const key = token.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) {
            args.set(key, true);
        } else {
            args.set(key, next);
            i++;
        }
    }
    return args;
}

function getString(args: Args, key: string): string | undefined {
    const value = args.get(key);
    return typeof value === "string" ? value : undefined;
}

function getNumber(args: Args, key: string): number | undefined {
    const value = getString(args, key);
    if (value === undefined) {
        return undefined;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

function readTranscript(args: Args): string {
    const path = getString(args, "transcript");
    if (!path) {
        fail("Missing required --transcript <file>.");
    }
    return readFileSync(resolve(path), "utf8");
}

function fail(message: string): never {
    console.error(message);
    console.error("");
    console.error(USAGE);
    process.exit(1);
}

async function runGenerate(args: Args): Promise<void> {
    const transcript = readTranscript(args);
    const out = getString(args, "out");
    if (!out) {
        fail("Missing required --out <questions.json>.");
    }
    const count = getNumber(args, "count") ?? 30;
    const model = createJudgeModel();
    console.log(`Generating ${count} questions...`);
    const questions = await generateQuestions(model, transcript, count);
    writeFileSync(resolve(out), JSON.stringify({ questions }, null, 2));
    console.log(`Wrote ${questions.length} questions to ${out}`);
}

// Resolve every curated question's reference answer via the transcript oracle
// when it does not already ship with one.
async function fillCuratedAnswers(
    model: Parameters<typeof answerFromTranscript>[0],
    transcript: string,
    curated: CuratedQuestion[],
): Promise<Question[]> {
    const filled: Question[] = [];
    for (const q of curated) {
        const answer =
            q.answer ??
            (await answerFromTranscript(model, transcript, q.question));
        filled.push({ ...q, answer });
    }
    return filled;
}

async function buildQuestionSet(
    args: Args,
    transcript: string,
    model: ReturnType<typeof createJudgeModel>,
): Promise<Question[]> {
    const questions: Question[] = [];

    const questionsFile = getString(args, "questions");
    if (questionsFile) {
        const raw = readFileSync(resolve(questionsFile), "utf8");
        const parsed = JSON.parse(raw) as { questions?: Question[] };
        if (parsed.questions) {
            questions.push(...parsed.questions);
        }
    }

    if (args.get("curated") === true) {
        console.log("Resolving reference answers for curated questions...");
        questions.push(
            ...(await fillCuratedAnswers(
                model,
                transcript,
                allCuratedQuestions(),
            )),
        );
    }

    const generateCount = getNumber(args, "generate");
    if (generateCount && generateCount > 0) {
        console.log(`Generating ${generateCount} questions...`);
        questions.push(
            ...(await generateQuestions(model, transcript, generateCount)),
        );
    }

    return questions;
}

async function runBenchmark(args: Args): Promise<void> {
    const transcript = readTranscript(args);
    const model = createJudgeModel();

    let questions = await buildQuestionSet(args, transcript, model);
    if (questions.length === 0) {
        fail(
            "No questions. Provide --questions <file>, --curated, and/or --generate N.",
        );
    }
    const maxQuestions = getNumber(args, "maxQuestions");
    if (maxQuestions && maxQuestions > 0) {
        questions = questions.slice(0, maxQuestions);
    }
    console.log(`Question set: ${questions.length} questions.`);

    // Ingest the transcript into a fresh REM instance.
    const rem = new RemSystem();
    console.log("Ingesting transcript into REM...");
    const ingestStart = Date.now();
    await rem.ingest(transcript, "transcript");
    console.log(
        `Ingest complete in ${((Date.now() - ingestStart) / 1000).toFixed(0)}s.`,
    );

    // Answer + grade each question.
    const graded: GradedQuestion[] = [];
    for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        console.log(`[ ${i + 1} / ${questions.length} ] ${q.question}`);
        const start = Date.now();
        let answer: string;
        try {
            answer = await rem.answer(q.question);
        } catch (e) {
            answer = `(error: ${(e as Error).message})`;
        }
        const seconds = ((Date.now() - start) / 1000).toFixed(0);
        console.log(`    REM: ${answer} [${seconds}s]`);

        const grading = await gradeAnswers(model, q, [{ id: 1, answer }]);
        const g = grading.gradedQuestions[0];
        if (g) {
            g.answer = answer;
            console.log(`    grade: ${g.isCorrect} — ${g.feedback}`);
            graded.push(g);
        }
    }

    printReport([{ system: rem.name, graded }]);

    const out = getString(args, "out");
    if (out) {
        writeFileSync(
            resolve(out),
            JSON.stringify({ system: rem.name, graded }, null, 2),
        );
        console.log("");
        console.log(`Wrote graded results to ${out}`);
    }
}

async function main(): Promise<void> {
    const [, , command, ...rest] = process.argv;
    const args = parseArgs(rest);
    switch (command) {
        case "generate":
            await runGenerate(args);
            break;
        case "run":
            await runBenchmark(args);
            break;
        default:
            fail(`Unknown command: ${command ?? "(none)"}`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
