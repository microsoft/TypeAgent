// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHmac, timingSafeEqual } from "node:crypto";
import { DomainError } from "../domain/index.js";

export type PacketContinuationState = {
    queryHash: string;
    indexVersion: number;
    consumedIds: readonly string[];
    topicBriefIncluded: boolean;
};

export interface PacketContinuationCodec {
    encode(state: PacketContinuationState): string;
    decode(cursor: string): PacketContinuationState;
}

export class HmacPacketContinuationCodec implements PacketContinuationCodec {
    readonly #secret: Buffer;

    public constructor(secret: string | Uint8Array) {
        this.#secret = Buffer.from(secret);
        if (this.#secret.byteLength < 32) {
            throw new DomainError(
                "INVALID_ARGUMENT",
                "Continuation secret must contain at least 32 bytes",
            );
        }
    }

    public encode(state: PacketContinuationState): string {
        const payload = Buffer.from(
            JSON.stringify({
                v: 1,
                q: state.queryHash,
                i: state.indexVersion,
                c: [...new Set(state.consumedIds)].sort(),
                b: state.topicBriefIncluded,
            }),
            "utf8",
        ).toString("base64url");
        return `${payload}.${this.sign(payload).toString("base64url")}`;
    }

    public decode(cursor: string): PacketContinuationState {
        try {
            if (cursor.length > 16_384) {
                return invalidCursor();
            }
            const parts = cursor.split(".");
            if (parts.length !== 2) {
                return invalidCursor();
            }
            const [payload, encodedSignature] = parts as [string, string];
            const signature = Buffer.from(encodedSignature, "base64url");
            const expected = this.sign(payload);
            if (
                signature.byteLength !== expected.byteLength ||
                !timingSafeEqual(signature, expected)
            ) {
                return invalidCursor();
            }
            const value = JSON.parse(
                Buffer.from(payload, "base64url").toString("utf8"),
            ) as Record<string, unknown>;
            if (
                value.v !== 1 ||
                typeof value.q !== "string" ||
                !Number.isSafeInteger(value.i) ||
                (value.i as number) < 0 ||
                !Array.isArray(value.c) ||
                value.c.length > 2_000 ||
                !value.c.every(
                    (item) => typeof item === "string" && item.length > 0,
                ) ||
                typeof value.b !== "boolean"
            ) {
                return invalidCursor();
            }
            return {
                queryHash: value.q,
                indexVersion: value.i as number,
                consumedIds: value.c as string[],
                topicBriefIncluded: value.b,
            };
        } catch (error) {
            if (error instanceof DomainError) {
                throw error;
            }
            return invalidCursor();
        }
    }

    private sign(payload: string): Buffer {
        return createHmac("sha256", this.#secret).update(payload).digest();
    }
}

function invalidCursor(): never {
    throw new DomainError("INVALID_ARGUMENT", "Invalid continuation cursor");
}
