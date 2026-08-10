#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUN = __dirname;
const tsRoot = path.resolve(RUN, "../../../../../");

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv(path.join(tsRoot, ".env.real"));

const EVAL_MODELS = [
  "gpt-4o",
  "gpt-4.1",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "claude-haiku-4*",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-opus-4-8*",
  "claude-opus-5*",
];
for (const id of EVAL_MODELS) {
  process.env[`OPENAI_MODEL_${id}`] = id;
}
// Generator/reviewer settings from config.local.yml (env TB_* overrides).
const { tbConfig } = await import("./tbConfig.mjs");
const { createTpmLimiter } = await import("./tpmLimiter.mjs");
const CFG = tbConfig();
const TPM = createTpmLimiter(CFG);
const GENERATOR_MODEL = CFG.generatorModel;
const REVIEWER_MODEL = CFG.reviewerModel;
const CASE_COUNT = CFG.caseCount;
const GEN_CASES = CFG.genCases; // lean test: 1 pos + 1 neg
const MAX_ATTEMPTS = CFG.maxAttempts;
const CONCURRENCY = CFG.genConcurrency;

const aiclient = await import(
  pathToFileURL(path.join(tsRoot, "packages/aiclient/dist/index.js")).href
);
aiclient.initRuntimeConfigFromProcessEnv();

const available = await aiclient.getChatModelNames();
console.log("configured models:", available.join(", "));

const dap = await import(
  pathToFileURL(
    path.join(tsRoot, "packages/defaultAgentProvider/dist/index.js"),
  ).href
);
const disp = await import(
  pathToFileURL(
    path.join(tsRoot, "packages/dispatcher/dispatcher/dist/internal.js"),
  ).href
);
const genMod = await import(
  pathToFileURL(
    path.join(
      tsRoot,
      "packages/benchmarks/dist/translationBench/synthesizer/datasetGenerator.js",
    ),
  ).href
);
const bmMod = await import(
  pathToFileURL(
    path.join(
      tsRoot,
      "packages/benchmarks/dist/translationBench/synthesizer/benchmark.js",
    ),
  ).href
);
const promptsMod = await import(
  pathToFileURL(
    path.join(
      tsRoot,
      "packages/benchmarks/dist/translationBench/synthesizer/synthesizerPrompts.js",
    ),
  ).href
);

// Hardcoded probe set from package constant (no env). Always on.
const AMBIGUITY_PROBE_MODELS = [
  ...(genMod.TRANSLATION_BENCH_DEFAULT_AMBIGUITY_PROBE_MODELS ?? [
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
  ]),
];
for (const m of [
  GENERATOR_MODEL,
  REVIEWER_MODEL,
  ...AMBIGUITY_PROBE_MODELS,
]) {
  if (!available.includes(m)) {
    throw new Error(
      `Model '${m}' not configured. Available: ${available.join(", ")}`,
    );
  }
}
function createTranslationBenchUsageAccumulator() {
  let promptTokens = 0;
  let completionTokens = 0;
  let cachedTokens = 0;
  let reasoningTokens = 0;
  let hasBase = false;
  let hasCached = false;
  let hasReasoning = false;
  return {
    add(usage) {
      if (
        usage &&
        Number.isFinite(usage.prompt_tokens) &&
        Number.isFinite(usage.completion_tokens)
      ) {
        hasBase = true;
        promptTokens += usage.prompt_tokens;
        completionTokens += usage.completion_tokens;
      }
      const extra = usage || {};
      if (Number.isFinite(extra.cached_tokens)) {
        hasCached = true;
        cachedTokens += extra.cached_tokens;
      }
      if (Number.isFinite(extra.reasoning_tokens)) {
        hasReasoning = true;
        reasoningTokens += extra.reasoning_tokens;
      }
    },
    finish() {
      return {
        ...(hasBase
          ? { promptTokens, completionTokens }
          : {}),
        ...(hasCached ? { cachedTokens } : {}),
        ...(hasReasoning ? { reasoningTokens } : {}),
      };
    },
  };
}

// Ensure seed adapter registered
await import(
  pathToFileURL(
    path.join(
      tsRoot,
      "packages/benchmarks/dist/translationBench/synthesizer/adapters/seedQaJsonlAdapter.js",
    ),
  ).href
);

const instanceDir = path.join(RUN, "instance");
fs.mkdirSync(instanceDir, { recursive: true });

const options = {
  ...dap.getDefaultDispatcherOptions(),
  appAgentProviders: dap.getDefaultAppAgentProviders(instanceDir),
  explanationAsynchronousMode: false,
  persistSession: false,
  metrics: false,
};

console.log("Initializing command handler context...");
const context = await disp.initializeCommandHandlerContext(
  "translation-bench-1k",
  options,
);
const provider = context.agents;

const sourcePath = path.join(RUN, "source/anchors-1100.jsonl");
const manifestPath = path.join(RUN, "source/source-manifest.json");
const outPath =
  process.env.TB_OUT_PATH ||
  path.join(RUN, "artifacts/benchmark-draft-1000.jsonl");
const checkpointPath =
  process.env.TB_CHECKPOINT_PATH ||
  path.join(RUN, "artifacts/generate-checkpoint.jsonl");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.mkdirSync(path.dirname(checkpointPath), { recursive: true });
const sourceText = fs.readFileSync(sourcePath, "utf8");
const sourceManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

function createOpenAISettings(modelName) {
  return {
    provider: "openai",
    modelType: 'chat',
    apiKey: process.env.OPENAI_API_KEY,
    endpoint: process.env.OPENAI_ENDPOINT,
    modelName,
    supportsResponseFormat: true,
    // Workers each call generator + reviewer; leave headroom above row concurrency.
    maxConcurrency: Math.max(CONCURRENCY * 2, 8),
    timeout: 180_000,
    maxRetryAttempts: 3,
  };
}

function createGenerationLlm(modelName, role, limiter) {
  let modelConfiguration;
  if (role === "generator") {
    modelConfiguration =
      promptsMod.loadTranslationBenchSynthesizerPromptPack().modelConfiguration;
  } else {
    modelConfiguration =
      promptsMod.loadTranslationBenchQualityVerifierPromptPack().semanticChecker
        .modelConfiguration;
  }
  const fromPrompt =
    promptsMod.completionSettingsFromModelConfiguration(modelConfiguration);
  const model = aiclient.openai.createChatModel(
    createOpenAISettings(modelName),
    {
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      verbosity: "low",
      temperature: 1,
      ...fromPrompt,
    },
    undefined,
    [`translation-bench-dataset-${role}`],
  );
  return {
    model: modelName,
    async complete(prompt, jsonSchema) {
      return limiter.run(modelName, undefined, async () => {
        const usageAccumulator = createTranslationBenchUsageAccumulator();
        const result = await model.complete(
          prompt,
          (usage) => usageAccumulator.add(usage),
          jsonSchema,
        );
        if (!result.success) {
          throw new Error(
            `Translation-bench ${role} model failed: ${result.message}`,
          );
        }
        const measured = usageAccumulator.finish();
        const usage =
          measured.promptTokens === undefined ||
          measured.completionTokens === undefined
            ? undefined
            : {
                promptTokens: measured.promptTokens,
                completionTokens: measured.completionTokens,
                ...(measured.cachedTokens !== undefined
                  ? { cachedTokens: measured.cachedTokens }
                  : {}),
                ...(measured.reasoningTokens !== undefined
                  ? { reasoningTokens: measured.reasoningTokens }
                  : {}),
              };
        const actualTokens =
          usage !== undefined
            ? usage.promptTokens + usage.completionTokens
            : undefined;
        return {
          result: {
            text: result.data,
            ...(usage !== undefined ? { usage } : {}),
            ...(measured.estimatedCostUsd !== undefined
              ? { estimatedCostUsd: measured.estimatedCostUsd }
              : {}),
          },
          actualTokens,
        };
      });
    },
  };
}

/**
 * Isolated ActionContext that forces translation.model for one probe call.
 * Mirrors the eval runner's createTranslationBenchContext pattern so concurrent
 * workers do not clobber each other's model selection.
 */
function createProbeActionContext(modelName) {
  const live = context;
  const baseConfig = live.session.getConfig();
  const config = structuredClone(baseConfig);
  config.translation = {
    ...config.translation,
    enabled: true,
    model: modelName,
    stream: false,
  };
  const session = new Proxy(live.session, {
    get(target, property) {
      if (property === "getConfig") return () => config;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const isolated = {
    ...live,
    session,
    activityContext: undefined,
    lastActionSchemaName: "",
    pendingTopicalRoute: undefined,
    translatorCache: new Map(),
  };
  return {
    sessionContext: {
      agentContext: isolated,
    },
  };
}

function createAmbiguityProbeTranslator() {
  return {
    models: AMBIGUITY_PROBE_MODELS,
    async translate({ model, utterance, history, activeSchemas }) {
      try {
        const actionContext = createProbeActionContext(model);
        let historyCtx;
        if (history !== undefined && disp.isChatHistoryInput?.(history)) {
          // HistoryContext for translateRequest is built from the live agent
          // context when available; for labeled ChatHistoryInput we pass through
          // only if createHistoryContext is not required (translate accepts HistoryContext).
          historyCtx = undefined;
        }
        const translated = await disp.translateRequest(
          actionContext,
          utterance,
          historyCtx,
          undefined,
          undefined,
          [...activeSchemas],
        );
        const actions = translated.requestAction.actions.map((entry) => {
          const a = entry.action;
          return {
            schemaName: a.schemaName,
            actionName: a.actionName,
            ...(a.parameters !== undefined ? { parameters: a.parameters } : {}),
          };
        });
        return { model, actions };
      } catch (error) {
        return {
          model,
          actions: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

console.log(
  `Generating ${CASE_COUNT} rows × ${GEN_CASES} gen-cases; concurrency=${CONCURRENCY}; generator=${GENERATOR_MODEL} reviewer=${REVIEWER_MODEL}; ambiguity_probe=${AMBIGUITY_PROBE_MODELS.length}-models`,
);
const started = Date.now();
try {
  const result = await genMod.generateTranslationBenchBenchmark({
    name: "typeagent-translation-bench-1k-all-actions",
    sourceText,
    sourceManifest,
    provider,
    caseCount: CASE_COUNT,
    genCaseCount: GEN_CASES,
    maxAttempts: MAX_ATTEMPTS,
    requireCompleteCoverage: process.env.TB_REQUIRE_COMPLETE_COVERAGE !== "0",
    concurrency: CONCURRENCY,
    generator: createGenerationLlm(GENERATOR_MODEL, "generator", TPM),
    reviewer: createGenerationLlm(REVIEWER_MODEL, "reviewer", TPM),
    ambiguityProbe: createAmbiguityProbeTranslator(),
    checkpointPath,
    resume: fs.existsSync(checkpointPath),
    onProgress(completed, total, coverage) {
      const pct = ((completed / total) * 100).toFixed(1);
      const elapsed = ((Date.now() - started) / 1000).toFixed(0);
      const rate = completed > 0 ? (Number(elapsed) / completed).toFixed(1) : "?";
      const cov =
        coverage !== undefined
          ? ` actions=${coverage.actionsCovered}/${coverage.actionsTotal} remain=${coverage.actionsRemaining} onTrack=${coverage.onTrack ? "yes" : "NO"}`
          : "";
      console.log(
        `[gen] ${completed}/${total} (${pct}%) elapsed=${elapsed}s sec_per_row=${rate} concurrency=${CONCURRENCY}${cov}`,
      );
      if (coverage && !coverage.onTrack) {
        console.error(
          `[gen][coverage-off-track] missing sample: ${(coverage.missingActionsSample || []).join(", ")}`,
        );
      }
    },
  });
  fs.writeFileSync(
    outPath,
    bmMod.formatTranslationBenchBenchmarkJsonl(result.benchmark),
  );
  const coverage = result.coverage;
  console.log(
    JSON.stringify(
      {
        outPath,
        rows: result.benchmark.cases.length,
        genCases: GEN_CASES,
        coverage,
        elapsedSec: (Date.now() - started) / 1000,
      },
      null,
      2,
    ),
  );
} finally {
  await disp.closeCommandHandlerContext(context);
}
