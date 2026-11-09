// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";

export interface ConstructionSource {
    id: string;
    version: string;
    title: string;
    text: string;
    sha256: string;
    authoredAt?: string;
}

export interface ConstructionBundle {
    id: string;
    kind: "wiki" | "projectBrief";
    query: string;
    aliases: string[];
    project?: { id: string; meetingIds: string[] };
    sources: ConstructionSource[];
}

export interface ConstructionPacket {
    schemaVersion: 1;
    purpose: "construction-only";
    dataset: string;
    release?: Record<string, unknown>;
    bundles: ConstructionBundle[];
}

export const digest = (value: string) =>
    createHash("sha256").update(value).digest("hex");

function record(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error(`${name}: object required`);
    return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim())
        throw new Error(`${name}: nonempty text required`);
    return value;
}

function identifier(value: unknown, name: string): string {
    const result = text(value, name);
    if (!/^[A-Za-z0-9_-]+$/.test(result))
        throw new Error(`${name}: invalid identifier`);
    return result;
}

function array(value: unknown, name: string): unknown[] {
    if (!Array.isArray(value)) throw new Error(`${name}: array required`);
    return value;
}

function distinct(values: string[], name: string): void {
    if (new Set(values).size !== values.length)
        throw new Error(`${name}: duplicate identifier`);
}

export function parseConstructionPacket(value: unknown): ConstructionPacket {
    const packet = record(value, "packet");
    if (packet.schemaVersion !== 1 || packet.purpose !== "construction-only")
        throw new Error(
            "Construction-only packet schema/custody marker required",
        );
    const bundles = array(packet.bundles, "bundles").map(
        (raw): ConstructionBundle => {
            const bundle = record(raw, "bundle");
            if (bundle.kind !== "wiki" && bundle.kind !== "projectBrief")
                throw new Error("Unsupported informational view kind");
            const query = text(bundle.query, "query");
            const aliases = array(bundle.aliases, "aliases").map((alias) =>
                text(alias, "alias"),
            );
            if (
                query.length > 200 ||
                aliases.length > 7 ||
                aliases.some((alias) => alias.length > 200)
            )
                throw new Error("Informational query/alias bounds exceeded");
            const sources = array(bundle.sources, "sources").map(
                (rawSource) => {
                    const source = record(rawSource, "source");
                    const retained = text(source.text, "source.text");
                    if (source.sha256 !== digest(retained))
                        throw new Error("Retained source hash mismatch");
                    const authoredAt = source.authoredAt;
                    if (
                        authoredAt !== undefined &&
                        (typeof authoredAt !== "string" ||
                            !/^\d{4}-\d{2}-\d{2}T/.test(authoredAt) ||
                            !Number.isFinite(Date.parse(authoredAt)))
                    )
                        throw new Error("Invalid source-authored timestamp");
                    return {
                        id: identifier(source.id, "source.id"),
                        version: text(source.version, "source.version"),
                        title: text(source.title, "source.title"),
                        text: retained,
                        sha256: digest(retained),
                        ...(typeof authoredAt === "string"
                            ? { authoredAt }
                            : {}),
                    };
                },
            );
            if (!sources.length)
                throw new Error("Construction bundle has no sources");
            distinct(
                sources.map((source) => source.id),
                "sources",
            );
            const id = identifier(bundle.id, "bundle.id");
            let project: ConstructionBundle["project"];
            if (bundle.project !== undefined) {
                const rawProject = record(bundle.project, "project");
                const projectId = identifier(rawProject.id, "project.id");
                const meetingIds = array(
                    rawProject.meetingIds,
                    "project.meetingIds",
                ).map((meetingId) =>
                    identifier(meetingId, "project.meetingId"),
                );
                if (
                    bundle.kind !== "projectBrief" ||
                    projectId !== id ||
                    JSON.stringify(meetingIds) !==
                        JSON.stringify(sources.map((source) => source.id))
                )
                    throw new Error(
                        "Canonical project identity and ordered meetings must match the brief sources",
                    );
                project = { id: projectId, meetingIds };
            }
            return {
                id,
                kind: bundle.kind,
                query,
                aliases,
                ...(project ? { project } : {}),
                sources,
            };
        },
    );
    if (!bundles.length) throw new Error("Construction packet has no bundles");
    distinct(
        bundles.map((bundle) => bundle.id),
        "bundles",
    );
    return {
        schemaVersion: 1,
        purpose: "construction-only",
        dataset: text(packet.dataset, "dataset"),
        ...(packet.release === undefined
            ? {}
            : { release: record(packet.release, "release") }),
        bundles,
    };
}
