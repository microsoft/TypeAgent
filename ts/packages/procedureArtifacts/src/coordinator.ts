// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcedureVersion } from "@typeagent/memory-service";
import {
    validateRunbookCatalogBindings,
    type RunbookBindingValidator,
} from "@typeagent/memory-service";
import type { CatalogEntry } from "@typeagent/skill-catalog";
import { createMacroDraft } from "./macroDraft.js";
import { createSkillPackage } from "./skillPackage.js";
import type {
    MacroArtifactPublisher,
    ProcedureArtifactGenerator,
    ProcedureSkillOptions,
    PublishedMacroResult,
    SkillCatalogPublisher,
} from "./types.js";

export class ProcedureArtifactCoordinator<TResult = unknown>
    implements ProcedureArtifactGenerator
{
    public constructor(
        private readonly skillCatalog: SkillCatalogPublisher,
        private readonly macroPublisher: MacroArtifactPublisher<TResult>,
        private readonly runbookBindingValidator?: RunbookBindingValidator,
    ) {}

    public createSkillPackage(
        procedure: ProcedureVersion,
        options: ProcedureSkillOptions,
    ) {
        return createSkillPackage(procedure, options);
    }

    public createMacroDraft(procedure: ProcedureVersion) {
        return createMacroDraft(procedure);
    }

    public async publishSkill(
        procedure: ProcedureVersion,
        options: ProcedureSkillOptions,
    ): Promise<CatalogEntry> {
        const input = this.createSkillPackage(procedure, options);
        if (procedure.document.agentEdition !== undefined) {
            await validateRunbookCatalogBindings(
                procedure.document.agentEdition,
                this.runbookBindingValidator,
            );
        }
        return this.skillCatalog.publish(input);
    }

    public async publishMacro(
        procedure: ProcedureVersion,
    ): Promise<PublishedMacroResult<TResult>> {
        const draft = this.createMacroDraft(procedure);
        if (draft.status !== "ready") return draft;
        const published = await this.macroPublisher.publishMacro(
            draft.macro,
            draft.lineage,
        );
        return { ...draft, status: "published", published };
    }
}
