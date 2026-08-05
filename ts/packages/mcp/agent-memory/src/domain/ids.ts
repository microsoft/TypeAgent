// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { randomBytes } from "node:crypto";
import { invalidArgument } from "./errors.js";

declare const idBrand: unique symbol;

export type Id<TKind extends string> = string & {
    readonly [idBrand]: TKind;
};

export type ScopeId = Id<"Scope">;
export type TopicId = Id<"Topic">;
export type TurnId = Id<"Turn">;
export type TermId = Id<"Term">;
export type ActionId = Id<"Action">;
export type ArtifactId = Id<"Artifact">;
export type GoalId = Id<"Goal">;
export type DesignNoteId = Id<"DesignNote">;
export type OutputId = Id<"Output">;
export type PropertyDefinitionId = Id<"PropertyDefinition">;
export type MemoryId = Id<"Memory">;
export type RetrievalId = Id<"Retrieval">;
export type StateEventId = Id<"StateEvent">;

export interface Clock {
    now(): Date;
}

export interface IdGenerator {
    generate<TKind extends string>(kind: TKind): Id<TKind>;
}

export class SystemClock implements Clock {
    public now(): Date {
        return new Date();
    }
}

export class FixedClock implements Clock {
    public constructor(private current: Date) {}

    public now(): Date {
        return new Date(this.current);
    }

    public set(value: Date): void {
        this.current = new Date(value);
    }
}

export class SequenceIdGenerator implements IdGenerator {
    private nextValue = 0;

    public constructor(private readonly timestamp = 0) {}

    public generate<TKind extends string>(_kind: TKind): Id<TKind> {
        const value = this.nextValue++;
        const timestampHex = this.timestamp.toString(16).padStart(12, "0");
        const sequenceHex = value.toString(16).padStart(15, "0");
        return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8)}-7000-8000-${sequenceHex.slice(-12)}` as Id<TKind>;
    }
}

export class UuidV7IdGenerator implements IdGenerator {
    public constructor(private readonly clock: Clock = new SystemClock()) {}

    public generate<TKind extends string>(_kind: TKind): Id<TKind> {
        const bytes = randomBytes(16);
        let timestamp = this.clock.now().getTime();

        for (let index = 5; index >= 0; index--) {
            bytes[index] = timestamp & 0xff;
            timestamp = Math.floor(timestamp / 256);
        }

        bytes[6] = 0x70 | (bytes[6]! & 0x0f);
        bytes[8] = 0x80 | (bytes[8]! & 0x3f);

        const hex = bytes.toString("hex");
        return [
            hex.slice(0, 8),
            hex.slice(8, 12),
            hex.slice(12, 16),
            hex.slice(16, 20),
            hex.slice(20),
        ].join("-") as Id<TKind>;
    }
}

const uuidV7Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function asId<TKind extends string>(
    value: string,
    kind: TKind,
): Id<TKind> {
    if (!uuidV7Pattern.test(value)) {
        return invalidArgument(`Invalid ${kind} ID`, { kind, value });
    }
    return value as Id<TKind>;
}
