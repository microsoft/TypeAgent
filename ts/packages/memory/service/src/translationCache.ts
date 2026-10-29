// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import {
    currentSearchAbortSignal,
    recordSearchTiming,
    type SearchQueryTranslator,
} from "@typeagent/knowpro";
import type { Result } from "typechat";

export class TranslationCache {
    private readonly entries = new Map<
        string,
        {
            corpusId: string;
            value: Result<unknown>;
            bytes: number;
            expiresAt: number;
            timer: ReturnType<typeof setTimeout>;
        }
    >();
    private bytes = 0;
    private epoch = 0;
    private closed = false;

    constructor(private readonly now: () => number = Date.now) {}

    wrap(
        corpusId: string,
        modelIdentity: string,
        translator: SearchQueryTranslator,
    ): SearchQueryTranslator {
        return {
            translate: (question, context) =>
                this.translate(
                    corpusId,
                    [modelIdentity, "v1", question, context],
                    () => translator.translate(question, context),
                ),
            ...(translator.translate2
                ? {
                      translate2: (question, context) =>
                          this.translate(
                              corpusId,
                              [modelIdentity, "v2", question, context],
                              () => translator.translate2!(question, context),
                          ),
                  }
                : {}),
        };
    }

    private async translate<T>(
        corpusId: string,
        identity: unknown[],
        load: () => Promise<Result<T>>,
    ): Promise<Result<T>> {
        currentSearchAbortSignal()?.throwIfAborted();
        if (this.closed) throw new Error("Translation cache is closed");
        const key = createHash("sha256")
            .update(JSON.stringify([corpusId, ...identity]))
            .digest("hex");
        const cached = this.entries.get(key);
        if (cached && cached.expiresAt > this.now()) {
            this.entries.delete(key);
            this.entries.set(key, cached);
            recordSearchTiming("translation.cache", 0, { hit: true });
            // The key includes the translator schema and complete prompt context.
            return structuredClone(cached.value) as Result<T>;
        }
        this.delete(key);
        recordSearchTiming("translation.cache", 0, { hit: false });
        const epoch = this.epoch;
        const value = await load();
        currentSearchAbortSignal()?.throwIfAborted();
        if (!value.success || this.closed || epoch !== this.epoch) return value;
        // Relative date interpretation must be recomputed, even for an identical prompt.
        if (
            /\b(today|yesterday|tomorrow|tonight|now|ago|last|next|this|current|recent|past|prior|previous|latest|earlier|later|week|month|year)\b/i.test(
                String(identity[2]),
            )
        )
            return value;
        const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
        if (bytes > 64 * 1024) return value;
        this.delete(key);
        while (this.entries.size >= 128 || this.bytes + bytes > 1024 * 1024) {
            const oldest = this.entries.keys().next().value;
            if (oldest === undefined) break;
            this.delete(oldest);
        }
        const timer = setTimeout(() => this.delete(key), 5 * 60_000);
        timer.unref();
        this.entries.set(key, {
            corpusId,
            value: structuredClone(value),
            bytes,
            expiresAt: this.now() + 5 * 60_000,
            timer,
        });
        this.bytes += bytes;
        return value;
    }

    invalidate(corpusId?: string): void {
        this.epoch++;
        for (const [key, entry] of this.entries)
            if (!corpusId || entry.corpusId === corpusId) this.delete(key);
    }

    close(): void {
        this.closed = true;
        this.invalidate();
    }

    private delete(key: string): void {
        const entry = this.entries.get(key);
        if (entry) {
            clearTimeout(entry.timer);
            this.bytes -= entry.bytes;
        }
        this.entries.delete(key);
    }
}
