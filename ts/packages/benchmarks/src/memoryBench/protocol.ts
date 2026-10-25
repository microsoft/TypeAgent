// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { execFileSync } from "node:child_process";
import { z } from "zod";
import { decodeEscapes, parseLiteral } from "./literal.js";
import { digest, readJson, saveJson, string } from "./storage.js";

export const ambCommit = "16fcebb0066537e890c6015c9d4a2b2eac952249";
export const protocolSchema = z.object({
    ambCommit: z.literal(ambCommit),
    beamAnswer: z.string().min(1),
    rubricJudge: z.string().min(1),
    equivalence: z.string().min(1),
    sourceHash: z.string().min(1),
});
export type Protocol = z.infer<typeof protocolSchema>;
function method(source: string, name: string): string {
    const start = source.indexOf(`    def ${name}(`);
    if (start < 0) throw new Error(`Pinned AMB method not found: ${name}`);
    const remaining = source.slice(start + 1);
    const end = remaining.search(/\n    (?:def |@)/);
    return end < 0 ? remaining : remaining.slice(0, end);
}
function triple(source: string, name: string, assignment: string): string {
    const body = method(source, name);
    const start = body.indexOf(`${assignment} f"""`);
    if (start < 0) throw new Error(`Pinned template not found: ${name}`);
    const content = body.slice(start + assignment.length + 5);
    const end = content.indexOf('"""');
    if (end < 0) throw new Error("Unterminated pinned template");
    return decodeEscapes(content.slice(0, end));
}
export async function prepareProtocol(
    root: string,
    output: string,
): Promise<Protocol> {
    const revision = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
        encoding: "utf8",
    }).trim();
    if (revision !== ambCommit)
        throw new Error(`AMB must be pinned to ${ambCommit}`);
    const beam = execFileSync(
        "git",
        ["-C", root, "show", `${ambCommit}:src/memory_bench/dataset/beam.py`],
        { encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    const answer = method(beam, "build_rag_prompt");
    const expression = answer.slice(answer.indexOf("return (") + 8);
    const literals = [...expression.matchAll(/f?("(?:\\.|[^"\\])*")/g)].map(
        (match) => string(parseLiteral(match[1])),
    );
    if (literals.length !== 11)
        throw new Error("Pinned BEAM answer template changed");
    const protocol = protocolSchema.parse({
        ambCommit,
        beamAnswer: literals.join(""),
        rubricJudge: triple(beam, "_rubric_item_score", "prompt ="),
        equivalence: triple(beam, "_llm_equivalence", "prompt ="),
        sourceHash: digest(beam),
    });
    await saveJson(output, protocol);
    return protocol;
}
export async function loadProtocol(file: string) {
    return protocolSchema.parse(await readJson(file));
}
export function render(
    template: string,
    values: Record<string, string>,
): string {
    return template.replace(
        /{{|}}|{(\w+)}/g,
        (match, key: string | undefined) => {
            if (match === "{{") return "{";
            if (match === "}}") return "}";
            if (key === undefined || !(key in values))
                throw new Error(`Missing template value: ${key}`);
            return values[key];
        },
    );
}
