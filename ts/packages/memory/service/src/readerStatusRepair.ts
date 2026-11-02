// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { timeSearchStage } from "@typeagent/knowpro";
import type { AnswerEvidence } from "./types.js";

export class ReaderStatusMismatch extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReaderStatusMismatch";
    }
}

export class ReaderCitationMismatch extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReaderCitationMismatch";
    }
}

export function readerCitationBundle(item: AnswerEvidence): string[] {
    return item.kind === "source"
        ? [item.id]
        : [
              ...new Set([
                  item.id,
                  ...item.supportingEvidenceIds,
                  ...item.opposingEvidenceIds,
              ]),
          ];
}

export function assertReaderOriginalCitations(
    item: AnswerEvidence,
    evidenceIds: readonly string[],
) {
    if (item.kind === "source") return;
    const required = readerCitationBundle(item);
    const missing = required.filter((id) => !evidenceIds.includes(id));
    if (missing.length)
        throw new ReaderCitationMismatch(
            `Reader claim citing ${item.id} omitted its original support or opposition references: ${missing.join(", ")}. Required same-claim evidenceIds: ${JSON.stringify(required)}`,
        );
}

const feedback =
    "The previous response failed status/citation consistency validation. Regenerate from the same supplied evidence using only statuses in the schema. An answered or partial response must support the requested fact and cite its evidence. Every claim citing a view must include all of that view's supportingEvidenceIds AND opposingEvidenceIds in that same claim's evidenceIds, not only in another section. Do not add citations for passages that were not supplied. For noAnswer or needsClarification, return an uncited explanation/question, empty evidenceIds and no sections; do not catalogue related factual claims. Respect the total claim limit. Never change status merely to retain citations or substitute a different fact for the requested one.";

export async function readWithStatusRepair<T>(
    complete: (feedback?: string) => Promise<string>,
    parse: (data: string) => T,
    signal?: AbortSignal,
): Promise<T> {
    signal?.throwIfAborted();
    const data = await complete();
    signal?.throwIfAborted();
    let reason: string;
    try {
        return parse(data);
    } catch (error) {
        if (
            !(error instanceof ReaderStatusMismatch) &&
            !(error instanceof ReaderCitationMismatch)
        )
            throw error;
        signal?.throwIfAborted();
        reason = error.message;
        console.warn(
            "Memory reader status/citation validation failed; repairing once",
            {
                reason,
            },
        );
    }
    const repaired = await timeSearchStage("memory.reader.statusRepair", () =>
        complete(`${feedback} Validation failure: ${reason}`),
    );
    signal?.throwIfAborted();
    return parse(repaired);
}
