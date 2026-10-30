// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { timeSearchStage } from "@typeagent/knowpro";

export class ReaderStatusMismatch extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ReaderStatusMismatch";
    }
}

const feedback =
    "The previous response failed status/citation consistency validation. Regenerate from the same supplied evidence using only statuses in the schema. An answered or partial response must support the requested fact and cite its evidence. For noAnswer or needsClarification, return an uncited explanation/question, empty evidenceIds and no sections; do not catalogue related factual claims. Respect the total claim limit. Never change status merely to retain citations or substitute a different fact for the requested one.";

export async function readWithStatusRepair<T>(
    complete: (feedback?: string) => Promise<string>,
    parse: (data: string) => T,
    signal?: AbortSignal,
): Promise<T> {
    signal?.throwIfAborted();
    const data = await complete();
    signal?.throwIfAborted();
    try {
        return parse(data);
    } catch (error) {
        if (!(error instanceof ReaderStatusMismatch)) throw error;
        signal?.throwIfAborted();
        console.warn("Memory reader status validation failed; repairing once", {
            reason: error.message,
        });
    }
    const repaired = await timeSearchStage("memory.reader.statusRepair", () =>
        complete(feedback),
    );
    signal?.throwIfAborted();
    return parse(repaired);
}
