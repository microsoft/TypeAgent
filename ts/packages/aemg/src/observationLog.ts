// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { Id, Observation } from "./types.js";

/**
 * Append-only observation log. Nothing is ever mutated or removed; canonical
 * state is derived by folding over these entries, which makes the system
 * replayable and auditable.
 */
export class ObservationLog {
    private readonly entries: Observation[] = [];

    append(obs: Observation): Observation {
        this.entries.push(obs);
        return obs;
    }

    get(id: Id): Observation | undefined {
        return this.entries.find((o) => o.id === id);
    }

    all(): readonly Observation[] {
        return this.entries;
    }

    get size(): number {
        return this.entries.length;
    }
}
