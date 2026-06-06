// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Observation, TrustTier } from "./model.js";

// A Feeder is any source that can turn raw input into REM observations. The
// knowledge-extraction feeder is one implementation; direct user assertions,
// tool observations, and external enrichment are others. All feeders share this
// interface so ingestion treats them uniformly and provenance stays honest.

/** Raw input handed to a feeder. */
export type FeederInput = {
    /** The text to mine for entities/relations. */
    text: string;
    /** Source reference (message id, document/blob id, url, ...). */
    source?: string;
    /** Observation time (epoch ms). Defaults to now at produce time. */
    timestamp?: number;
};

/** A source of observations for the memory. */
export interface Feeder {
    /** Stable feeder name recorded as provenance (e.g. "knowledge-extraction"). */
    readonly name: string;
    /** Trust tier assigned to every observation this feeder produces. */
    readonly tier: TrustTier;
    /** Produce zero or more observations from the input. */
    produce(input: FeederInput): Promise<Observation[]>;
}
