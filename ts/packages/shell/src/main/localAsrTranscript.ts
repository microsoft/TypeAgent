// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export class LocalAsrTranscript {
    private committed: string[] = [];
    private current = "";

    update(text: string, kind: "none" | "partial" | "final"): string {
        // Nemotron's non-segmented SDK stream uses "none" for token deltas.
        this.current = kind === "none" ? this.current + text : text;
        const hypothesis = [...this.committed, this.current]
            .filter(Boolean)
            .join(" ")
            .trim();
        if (kind === "final") {
            if (this.current) this.committed.push(this.current.trim());
            this.current = "";
        }
        return hypothesis;
    }
}
