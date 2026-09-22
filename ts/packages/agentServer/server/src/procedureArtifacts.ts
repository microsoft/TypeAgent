// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    ProcedureArtifactPreview,
    ProcedureArtifactPromotion,
    ProcedureArtifactRequest,
    ProcedureSkillArtifact,
    PublishSkillRequest,
} from "@typeagent/agent-server-protocol";
import type { MacroManager } from "@typeagent/copilot-macros";
import type {
    PersonalHowToService,
    ProcedureVersion,
} from "@typeagent/memory-service";
import {
    getProcedureLineage,
    ProcedureArtifactCoordinator,
    type ProcedureSkillOptions,
    type SkillArtifactInput,
} from "@typeagent/procedure-artifacts";
import type {
    LiveSkillCatalog,
    SkillPackageInput,
} from "@typeagent/skill-catalog";

type ProcedureResolver = Pick<PersonalHowToService, "getProcedure">;

function decodeArtifact(
    artifact: ProcedureSkillArtifact | undefined,
): SkillArtifactInput | undefined {
    if (artifact === undefined) return undefined;
    return {
        ...(artifact.path === undefined ? {} : { path: artifact.path }),
        content:
            artifact.encoding === "base64"
                ? Buffer.from(artifact.content, "base64")
                : artifact.content,
    };
}

function skillOptions(
    request: Extract<ProcedureArtifactRequest, { kind: "skill" }>,
): ProcedureSkillOptions {
    return {
        identity: request.skill.identity,
        ...(request.skill.description === undefined
            ? {}
            : { description: request.skill.description }),
        ...(request.skill.schema === undefined
            ? {}
            : { schema: decodeArtifact(request.skill.schema)! }),
        ...(request.skill.grammar === undefined
            ? {}
            : { grammar: decodeArtifact(request.skill.grammar)! }),
    };
}

function serializeSkill(input: SkillPackageInput): PublishSkillRequest {
    return {
        identity: input.identity,
        ...(input.displayName === undefined
            ? {}
            : { displayName: input.displayName }),
        ...(input.description === undefined
            ? {}
            : { description: input.description }),
        schemaFingerprint: input.schemaFingerprint,
        files: input.files.map((file) =>
            typeof file.content === "string"
                ? { path: file.path, content: file.content, encoding: "utf8" }
                : {
                      path: file.path,
                      content: Buffer.from(file.content).toString("base64"),
                      encoding: "base64",
                  },
        ),
    };
}

function macroPromotionError(
    result: Exclude<
        ReturnType<ProcedureArtifactCoordinator["createMacroDraft"]>,
        { status: "ready" }
    >,
): Error {
    if (result.status === "notAvailable") return new Error(result.reason);
    return new Error(
        `Procedure automation is invalid: ${result.errors
            .map(
                (item) =>
                    `${item.path === undefined ? "" : `${item.path}: `}${item.message}`,
            )
            .join("; ")}`,
    );
}

export class ProcedureArtifactRpcService {
    private readonly coordinator;

    public constructor(
        private readonly procedures: ProcedureResolver,
        skillCatalog: LiveSkillCatalog,
        macroManager: MacroManager,
    ) {
        this.coordinator = new ProcedureArtifactCoordinator(skillCatalog, {
            publishMacro: (macro) => macroManager.saveDraft(macro),
        });
    }

    public async preview(
        request: ProcedureArtifactRequest,
    ): Promise<ProcedureArtifactPreview> {
        const procedure = await this.resolve(request);
        if (request.kind === "macro") {
            return {
                kind: "macro",
                result: this.coordinator.createMacroDraft(procedure),
            };
        }
        const input = this.coordinator.createSkillPackage(
            procedure,
            skillOptions(request),
        );
        return {
            kind: "skill",
            lineage: getProcedureLineage(procedure),
            skill: serializeSkill(input),
        };
    }

    public async promote(
        request: ProcedureArtifactRequest,
    ): Promise<ProcedureArtifactPromotion> {
        const procedure = await this.resolve(request);
        if (request.kind === "skill") {
            const entry = await this.coordinator.publishSkill(
                procedure,
                skillOptions(request),
            );
            return {
                kind: "skill",
                lineage: getProcedureLineage(procedure),
                entry,
            };
        }
        const result = await this.coordinator.publishMacro(procedure);
        if (result.status !== "published") {
            throw macroPromotionError(result);
        }
        return {
            kind: "macro",
            lineage: result.lineage,
            macro: result.published,
        };
    }

    private async resolve(
        request: ProcedureArtifactRequest,
    ): Promise<ProcedureVersion> {
        if (!Number.isSafeInteger(request.version) || request.version < 1) {
            throw new Error("Procedure version must be a positive integer.");
        }
        const procedure = await this.procedures.getProcedure(
            request.corpusId,
            request.procedureId,
            request.version,
        );
        if (procedure === undefined) {
            throw new Error(
                `Procedure not found: ${request.corpusId}/${request.procedureId}@${request.version}`,
            );
        }
        if (procedure.version !== request.version) {
            throw new Error(
                `Resolved procedure version ${procedure.version} does not match requested version ${request.version}.`,
            );
        }
        if (procedure.state !== "saved") {
            throw new Error(
                `Procedure '${procedure.procedureId}' version ${procedure.version} cannot be promoted from ${procedure.state} state.`,
            );
        }
        return procedure;
    }
}
