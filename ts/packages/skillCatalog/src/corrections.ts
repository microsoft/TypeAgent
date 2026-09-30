// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    InstanceStorage,
    SkillGrammarRule,
    StoredCorrection,
} from "./types.js";
import {
    canonicalJson,
    qualifySkill,
    sha256,
    skillStorageKey,
    trimTrailingSlashes,
} from "./util.js";

interface CorrectionIndex {
    ids: string[];
}

export class SkillCorrectionStore {
    private readonly root: string;
    private mutation = Promise.resolve();

    public constructor(
        private readonly storage: InstanceStorage,
        root = "skill-catalog/v1/corrections",
    ) {
        this.root = trimTrailingSlashes(root);
    }

    public add(
        correction: Omit<StoredCorrection, "id" | "createdAt">,
    ): Promise<StoredCorrection> {
        return this.exclusive(async () => {
            qualifySkill(correction.skill);
            validateStorageSegment(correction.skillRevision, "skill revision");
            const id = sha256(canonicalJson(correction));
            const stored: StoredCorrection = {
                ...structuredClone(correction),
                id,
                createdAt: new Date().toISOString(),
            };
            const path = this.correctionPath(stored, id);
            if (await this.storage.exists(path)) {
                return JSON.parse(
                    await this.storage.read(path, "utf8"),
                ) as StoredCorrection;
            }
            await this.storage.write(path, canonicalJson(stored));
            const index = await this.readIndex(stored);
            index.ids.push(id);
            index.ids.sort();
            await this.storage.write(
                this.indexPath(stored),
                canonicalJson(index),
            );
            return stored;
        });
    }

    public async list(
        skill: StoredCorrection["skill"],
        skillRevision: string,
    ): Promise<readonly StoredCorrection[]> {
        validateStorageSegment(skillRevision, "skill revision");
        const template = { skill, skillRevision };
        const path = this.indexPath(template);
        if (!(await this.storage.exists(path))) {
            return [];
        }
        const index = JSON.parse(
            await this.storage.read(path, "utf8"),
        ) as CorrectionIndex;
        return Promise.all(
            index.ids.map(async (id) => {
                const correctionPath = this.correctionPath(template, id);
                return JSON.parse(
                    await this.storage.read(correctionPath, "utf8"),
                ) as StoredCorrection;
            }),
        );
    }

    public async grammarRules(
        skill: StoredCorrection["skill"],
        skillRevision: string,
    ): Promise<readonly SkillGrammarRule[]> {
        return (await this.list(skill, skillRevision)).map((correction) => ({
            id: correction.id,
            skill: correction.skill,
            skillRevision: correction.skillRevision,
            schemaFingerprint: correction.schemaFingerprint,
            source: "userCorrection",
            grammar: correction.grammar,
        }));
    }

    private async readIndex(value: {
        skill: StoredCorrection["skill"];
        skillRevision: string;
    }): Promise<CorrectionIndex> {
        const path = this.indexPath(value);
        return (await this.storage.exists(path))
            ? (JSON.parse(
                  await this.storage.read(path, "utf8"),
              ) as CorrectionIndex)
            : { ids: [] };
    }

    private indexPath(value: {
        skill: StoredCorrection["skill"];
        skillRevision: string;
    }): string {
        return `${this.root}/${skillStorageKey(value.skill)}/${value.skillRevision}/index.json`;
    }

    private correctionPath(
        value: {
            skill: StoredCorrection["skill"];
            skillRevision: string;
        },
        id: string,
    ): string {
        return `${this.root}/${skillStorageKey(value.skill)}/${value.skillRevision}/${id}.json`;
    }

    private exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.mutation.then(operation, operation);
        this.mutation = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}

function validateStorageSegment(value: string, name: string): void {
    if (
        value.length === 0 ||
        value === "." ||
        value === ".." ||
        /[\\/\u0000-\u001f]/.test(value)
    ) {
        throw new Error(`Invalid ${name}: ${value}`);
    }
}
