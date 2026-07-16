// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Public entrypoint for the contextSelector engine — the deterministic
// collision-resolution building blocks (conversation signal source, scorer,
// strategy, decision, keyword index/files/sidecar/vector, tokenizer). Exposed
// as a package subpath (`agent-dispatcher/contextSelector`) so out-of-package
// tooling and offline benchmarks can score against the exact production
// machinery without deep-importing internals. The runtime switch that consumes
// these building blocks stays inside the dispatcher.

export * from "./conversationSignal.js";
export * from "./decision.js";
export * from "./keywordFile.js";
export * from "./keywordIndex.js";
export * from "./keywordSidecar.js";
export * from "./keywordVector.js";
export * from "./scorer.js";
export * from "./strategy.js";
export * from "./tokenize.js";
