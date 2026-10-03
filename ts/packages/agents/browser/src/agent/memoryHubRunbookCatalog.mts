// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { parseDocument } from "yaml";
import { z } from "zod";
import type {
    RunbookHostCapabilities,
    RunbookSkillLifecycle,
} from "@typeagent/agent-server-protocol";
import type {
    RunbookSkill,
    RunbookSkillAction,
    RunbookSkillIdentity,
} from "@typeagent/browser-control-rpc/viewRpc";
import { timed } from "./memoryHubQuery.mjs";

type Entry = Awaited<ReturnType<RunbookHostCapabilities["listSkills"]>>[number];
const lineageSchema = z.strictObject({
    corpusId: z.string().min(1),
    procedureId: z.string().min(1),
    version: z.number().int().positive(),
    jsonHash: z.string().regex(/^[a-f0-9]{64}$/),
    markdownHash: z.string().regex(/^[a-f0-9]{64}$/),
});
type Lineage = z.infer<typeof lineageSchema>;

export function runbookSkillKey(
    identity: RunbookSkillIdentity,
    revisionId: string,
): string {
    return JSON.stringify([
        identity.scope,
        identity.origin,
        identity.name,
        revisionId,
    ]);
}

function skillActions(lifecycle: RunbookSkillLifecycle): RunbookSkillAction[] {
    const actions: RunbookSkillAction[] = [];
    for (const action of lifecycle.allowedActions) {
        if (action !== "changeState") actions.push(action);
    }
    if (lifecycle.allowedTransitions.includes("approved"))
        actions.push("approve");
    if (lifecycle.allowedTransitions.includes("draft")) actions.push("draft");
    return [...new Set(actions)];
}

export function runbookSkillDto(
    lifecycle: RunbookSkillLifecycle,
    lineage?: Lineage,
): RunbookSkill {
    const { entry } = lifecycle;
    return {
        identity: entry.revision.identity,
        revisionId: entry.revision.revision,
        state: entry.state,
        displayName: entry.revision.displayName,
        description: entry.revision.description,
        active: entry.active,
        createdAt: entry.revision.createdAt,
        files: entry.revision.manifest.map((file) => ({
            path: file.path,
            hash: file.sha256,
            size: file.size,
        })),
        ...(lineage === undefined ? {} : { lineage }),
        allowedActions: skillActions(lifecycle),
        findings: [],
    };
}

export async function readRunbookSkillText(
    capabilities: RunbookHostCapabilities,
    identity: RunbookSkillIdentity,
    revisionId: string,
    path: string,
): Promise<string> {
    const entry = await timed(
        capabilities.getSkill({ identity, revision: revisionId }),
    );
    const file = entry?.revision.manifest.find((file) => file.path === path);
    if (!file)
        throw new Error(
            `Skill file '${path}' is unavailable in the selected revision`,
        );
    if (file.size > 1_000_000)
        throw new Error("Skill text preview exceeds one million bytes");
    const result = await timed(
        capabilities.readSkillFile({ identity, revision: revisionId, path }),
    );
    const bytes = Buffer.from(result.content, "base64");
    if (bytes.length !== file.size)
        throw new Error(
            "Skill file size does not match its immutable manifest",
        );
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function parseLineage(markdown: string): Lineage | undefined {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
    if (!match) return undefined;
    const yaml = parseDocument(match[1], { uniqueKeys: true });
    if (yaml.errors.length)
        throw new Error(`Invalid skill metadata: ${yaml.errors[0].message}`);
    const metadata = z
        .object({ metadata: z.record(z.string(), z.unknown()).optional() })
        .parse(yaml.toJS({ maxAliasCount: 0 })).metadata;
    if (!metadata || metadata["typeagent-procedure-id"] === undefined)
        return undefined;
    return lineageSchema.parse({
        corpusId: metadata["typeagent-corpus-id"],
        procedureId: metadata["typeagent-procedure-id"],
        version: Number(metadata["typeagent-procedure-version"]),
        jsonHash: metadata["typeagent-json-hash"],
        markdownHash: metadata["typeagent-markdown-hash"],
    });
}

export function createRunbookCatalog(
    getCapabilities: () => RunbookHostCapabilities | undefined,
) {
    const lineageCache = new Map<string, Lineage | null>();
    function requireCapabilities(): RunbookHostCapabilities {
        const capabilities = getCapabilities();
        if (!capabilities)
            throw new Error(
                "The Runbooks skill and tool catalogs are unavailable in this host",
            );
        return capabilities;
    }
    async function describe(entry: Entry): Promise<RunbookSkill> {
        const capabilities = requireCapabilities();
        const revisionId = entry.revision.revision;
        const key = runbookSkillKey(entry.revision.identity, revisionId);
        let lineage = lineageCache.get(key);
        if (lineage === undefined) {
            const manifest = entry.revision.manifest.find(
                (file) => file.path === "SKILL.md",
            );
            lineage = manifest
                ? (parseLineage(
                      await readRunbookSkillText(
                          capabilities,
                          entry.revision.identity,
                          revisionId,
                          manifest.path,
                      ),
                  ) ?? null)
                : null;
            lineageCache.set(key, lineage);
        }
        return runbookSkillDto(
            await timed(
                capabilities.getSkillLifecycle({
                    identity: entry.revision.identity,
                    revision: revisionId,
                }),
            ),
            lineage ?? undefined,
        );
    }
    async function list(): Promise<{
        skills: RunbookSkill[];
        warnings: string[];
    }> {
        if (!getCapabilities())
            return {
                skills: [],
                warnings: [
                    "Skill and tool catalogs are unavailable; skill readiness cannot be determined.",
                ],
            };
        const capabilities = requireCapabilities();
        const skills: RunbookSkill[] = [];
        const warnings: string[] = [];
        let offset = 0;
        for (;;) {
            const entries = await timed(
                capabilities.listSkills({ limit: 100, offset }),
            );
            for (let index = 0; index < entries.length; index += 4) {
                await Promise.all(
                    entries.slice(index, index + 4).map(async (entry) => {
                        try {
                            skills.push(await describe(entry));
                        } catch (error) {
                            warnings.push(
                                `Skill '${entry.revision.qualifiedName}@${entry.revision.revision}': ${error instanceof Error ? error.message : String(error)}`,
                            );
                        }
                    }),
                );
            }
            if (entries.length < 100) break;
            offset += entries.length;
        }
        return { skills, warnings };
    }
    return { requireCapabilities, describe, list };
}
