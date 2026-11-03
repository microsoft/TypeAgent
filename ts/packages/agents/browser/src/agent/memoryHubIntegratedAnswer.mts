// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { conversationCorpusName } from "@typeagent/memory-service";
import type { MemoryCenterCorpus } from "@typeagent/browser-control-rpc/serviceTypes";
import type {
    MemoryHubSearchRequest,
    MemoryHubSearchResult,
} from "@typeagent/browser-control-rpc/viewRpc";
import type { MemoryHubReadService } from "./memoryHubQuery.mjs";

function isIntegratedAnswerScope(
    corpora: MemoryCenterCorpus[],
    request: MemoryHubSearchRequest,
): boolean {
    return (
        request.corpusId !== undefined &&
        corpora.length === 1 &&
        corpora[0].name !== conversationCorpusName &&
        !request.sourceTypes?.length &&
        !request.tags?.length &&
        !request.dateFrom &&
        !request.dateTo &&
        !request.viewKinds?.length &&
        (!request.conversationScope || request.conversationScope === "none")
    );
}

export async function tryMemoryHubIntegratedAnswer(
    service: MemoryHubReadService,
    corpora: MemoryCenterCorpus[],
    request: MemoryHubSearchRequest,
    result: MemoryHubSearchResult,
): Promise<boolean> {
    if (!request.generateAnswer && !request.prepareUnderstanding) return false;
    const capability = (await service.getCapabilities()).derivedViews
        ?.integratedAnswering;
    if (!capability || !isIntegratedAnswerScope(corpora, request)) {
        if (
            request.retrievalPolicy === "sourcesAndViews" ||
            request.knowledgeCheckpointId
        )
            throw new Error(
                "Strict sources-and-views answering requires a supporting host and one selected document collection without filters or conversations.",
            );
        if (capability)
            result.warnings.push(
                "Integrated knowledge answering requires one selected document collection without filters or conversations. This scope uses the bounded legacy evidence reader instead; derived knowledge coverage is not qualified.",
            );
        return false;
    }
    const corpus = corpora[0];
    const answer = await service.answer({
        corpusId: corpus.corpusId,
        question: result.query,
        ...(request.evidenceSnapshotId
            ? { evidenceSnapshotId: request.evidenceSnapshotId }
            : {}),
        ...(!request.generateAnswer ? { prepareOnly: true } : {}),
        ...(request.retrievalPolicy === undefined
            ? {}
            : { retrievalPolicy: request.retrievalPolicy }),
        ...(request.knowledgeCheckpointId === undefined
            ? {}
            : { knowledgeCheckpointId: request.knowledgeCheckpointId }),
        limit: 12,
        maxResponseChars: 24000,
    });
    result.matches = answer.citations.map((source, index) => ({
        id: source.evidenceId,
        kind: "source",
        corpusId: corpus.corpusId,
        corpusName: corpus.name,
        objectId: source.sourceId,
        title: source.title,
        snippet: source.snippet,
        score: source.score,
        rank: index + 1,
        sourceId: source.sourceId,
        revisionId: source.revisionId,
        sourceType: source.sourceType,
        ...(source.locator === undefined ? {} : { locator: source.locator }),
        ...(source.canonicalUri === undefined
            ? {}
            : { canonicalUri: source.canonicalUri }),
        ...(source.synopsis === undefined ? {} : { synopsis: source.synopsis }),
        ...(source.capturedAt === undefined
            ? {}
            : { eventTime: source.capturedAt }),
    }));
    result.warnings.push(...answer.warnings);
    if (answer.evidenceSnapshotId)
        result.evidenceSnapshotId = answer.evidenceSnapshotId;
    result.warnings.push(
        !request.generateAnswer
            ? "Bounded evidence retrieval prepared originals and maintained knowledge without generating an answer. Understand reuses this evidence."
            : request.retrievalPolicy === "sourcesOnly"
              ? "Sources-only diagnostic answering excludes maintained views; original evidence selection is bounded, not exhaustive."
              : "Knowledge answering uses bounded original evidence and eligible maintained views. Ready knowledge is relative to captured coverage, not exhaustive memory.",
    );
    if (request.generateAnswer)
        result.answer = {
            text: answer.answer,
            mode: answer.mode,
            citationIds: result.matches.map((source) => source.id),
            followUps: [],
            ...(answer.derivedReferences === undefined
                ? {}
                : {
                      derivedReferences: answer.derivedReferences.map(
                          (reference) => ({
                              corpusId: corpus.corpusId,
                              ...reference,
                          }),
                      ),
                  }),
            ...(answer.assertionReferences === undefined
                ? {}
                : {
                      assertionReferences: answer.assertionReferences.map(
                          (reference) => ({
                              corpusId: corpus.corpusId,
                              ...reference,
                          }),
                      ),
                  }),
        };
    return true;
}
