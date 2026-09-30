// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { GrammarJson } from "@typeagent/action-grammar";
import { SkillCatalog } from "./catalog.js";
import { SkillCorrectionStore } from "./corrections.js";
import { SkillGrammarIndex, type SkillGrammarRuntime } from "./grammarIndex.js";
import type {
    CatalogEntry,
    CatalogSearchQuery,
    CatalogSearchResult,
    CatalogState,
    InstanceStorage,
    PersistedRoutingSnapshot,
    SchemaValidator,
    SemanticSkillSearch,
    SkillGrammarDiagnostic,
    SkillGrammarRule,
    SkillGrammarRoutingResult,
    SkillIdentity,
    SkillPackageInput,
    SkillRevision,
    StoredCorrection,
} from "./types.js";
import { canonicalJson, qualifySkill } from "./util.js";

const routingRoot = "skill-catalog/v1/routing";

export interface LiveSkillCatalogOptions {
    readonly validate?: SchemaValidator;
    readonly grammarRuntime?: SkillGrammarRuntime;
    readonly semanticSearch?: SemanticSkillSearch;
}

export class LiveSkillCatalog {
    private readonly catalog: SkillCatalog;
    private readonly corrections: SkillCorrectionStore;
    private readonly grammarIndex: SkillGrammarIndex;
    private readonly semanticSearch: SemanticSkillSearch | undefined;
    private current: PersistedRoutingSnapshot | undefined;
    private operation = Promise.resolve();

    private constructor(
        private readonly storage: InstanceStorage,
        options: LiveSkillCatalogOptions,
    ) {
        this.catalog = new SkillCatalog(storage);
        this.corrections = new SkillCorrectionStore(storage);
        this.grammarIndex =
            options.grammarRuntime === undefined
                ? new SkillGrammarIndex(
                      options.validate ?? (() => ({ valid: true })),
                  )
                : new SkillGrammarIndex(
                      options.validate ?? (() => ({ valid: true })),
                      options.grammarRuntime,
                  );
        this.semanticSearch = options.semanticSearch;
    }

    public static async create(
        storage: InstanceStorage,
        options: LiveSkillCatalogOptions = {},
    ): Promise<LiveSkillCatalog> {
        const live = new LiveSkillCatalog(storage, options);
        await live.rebuild();
        return live;
    }

    public list(): Promise<CatalogEntry[]> {
        return this.exclusive(() => this.catalog.list());
    }

    public get(
        identity: SkillIdentity,
        revision?: string,
    ): Promise<CatalogEntry | undefined> {
        return this.exclusive(() => this.catalog.get(identity, revision));
    }

    public readFile(
        identity: SkillIdentity,
        revision: string,
        path: string,
    ): Promise<Uint8Array> {
        return this.exclusive(() =>
            this.catalog.readFile(identity, revision, path),
        );
    }

    public search(
        query: CatalogSearchQuery,
    ): Promise<readonly CatalogSearchResult[]> {
        return this.exclusive(async () => {
            const routing = this.matchCurrent(query.text, query.scopes);
            const fallback = await this.catalog.search(
                query,
                this.semanticSearch,
            );
            if (routing.outcome.status !== "match") {
                return fallback.map((result) => ({ ...result, routing }));
            }
            const candidate = routing.outcome.candidate;
            const entry = await this.catalog.get(
                candidate.skill,
                candidate.skillRevision,
            );
            if (entry === undefined || !entry.active) {
                const staleRouting: SkillGrammarRoutingResult = {
                    ...routing,
                    diagnostics: [
                        ...routing.diagnostics,
                        {
                            code: "staleMatch",
                            message: `Grammar matched inactive revision ${candidate.skillRevision}.`,
                            skill: candidate.skill,
                            skillRevision: candidate.skillRevision,
                        },
                    ],
                };
                return fallback.map((result) => ({
                    ...result,
                    routing: staleRouting,
                }));
            }
            const grammarResult: CatalogSearchResult = {
                entry,
                score: 2,
                source: "grammar",
                routing,
            };
            return [
                grammarResult,
                ...fallback
                    .filter(
                        (result) =>
                            result.entry.revision.qualifiedName !==
                                entry.revision.qualifiedName ||
                            result.entry.revision.revision !==
                                entry.revision.revision,
                    )
                    .map((result) => ({ ...result, routing })),
            ].slice(0, query.limit ?? 20);
        });
    }

    public routeGrammar(utterance: string): Promise<SkillGrammarRoutingResult> {
        return this.exclusive(async () => this.matchCurrent(utterance));
    }

    public publish(input: SkillPackageInput): Promise<CatalogEntry> {
        return this.mutate(() => this.catalog.publish(input));
    }

    public transition(
        identity: SkillIdentity,
        revision: string,
        state: CatalogState,
    ): Promise<CatalogEntry> {
        return this.mutate(() =>
            this.catalog.transition(identity, revision, state),
        );
    }

    public activate(
        identity: SkillIdentity,
        revision: string,
    ): Promise<CatalogEntry> {
        return this.mutate(() => this.catalog.activate(identity, revision));
    }

    public rollback(
        identity: SkillIdentity,
        revision: string,
    ): Promise<CatalogEntry> {
        return this.mutate(() => this.catalog.rollback(identity, revision));
    }

    public addCorrection(
        correction: Omit<StoredCorrection, "id" | "createdAt">,
    ): Promise<StoredCorrection> {
        return this.mutate(() => this.corrections.add(correction));
    }

    public rebuild(): Promise<PersistedRoutingSnapshot> {
        return this.exclusive(() => this.rebuildCore());
    }

    public getCurrentSnapshot(): PersistedRoutingSnapshot {
        if (this.current === undefined) {
            throw new Error("Live skill catalog has not been initialized.");
        }
        return structuredClone(this.current);
    }

    private async mutate<T>(operation: () => Promise<T>): Promise<T> {
        return this.exclusive(async () => {
            const result = await operation();
            await this.rebuildCore();
            return result;
        });
    }

    private async rebuildCore(): Promise<PersistedRoutingSnapshot> {
        const entries = (await this.catalog.list()).filter(
            (entry) => entry.active,
        );
        const rules: SkillGrammarRule[] = [];
        const diagnostics: SkillGrammarDiagnostic[] = [];
        for (const entry of entries) {
            const packageRules = await this.loadPackageRules(
                entry,
                diagnostics,
            );
            rules.push(...packageRules);
            const corrections = await this.corrections.grammarRules(
                entry.revision.identity,
                entry.revision.revision,
            );
            for (const rule of corrections) {
                if (
                    rule.schemaFingerprint !== entry.revision.schemaFingerprint
                ) {
                    continue;
                }
                try {
                    this.grammarIndex.buildSnapshot([rule]);
                    rules.push(rule);
                } catch (error) {
                    diagnostics.push(
                        diagnostic(
                            "artifactCompile",
                            entry.revision,
                            `correction:${rule.id}`,
                            error,
                        ),
                    );
                }
            }
        }
        const snapshot = this.grammarIndex.buildSnapshot(rules);
        const persisted: PersistedRoutingSnapshot = {
            snapshotId: snapshot.id,
            createdAt: snapshot.createdAt,
            activeRevisions: entries
                .map((entry) => ({
                    skill: entry.revision.identity,
                    revision: entry.revision.revision,
                    schemaFingerprint: entry.revision.schemaFingerprint,
                }))
                .sort((left, right) =>
                    `${qualifySkill(left.skill)}:${left.revision}`.localeCompare(
                        `${qualifySkill(right.skill)}:${right.revision}`,
                    ),
                ),
            rules,
            diagnostics,
        };
        this.current = persisted;
        const snapshotPath = `${routingRoot}/snapshots/${snapshot.id}.json`;
        if (!(await this.storage.exists(snapshotPath))) {
            await this.storage.write(snapshotPath, canonicalJson(persisted));
        }
        await this.storage.write(
            `${routingRoot}/current.json`,
            canonicalJson({
                snapshotId: snapshot.id,
                createdAt: snapshot.createdAt,
            }),
        );
        return structuredClone(persisted);
    }

    private async loadPackageRules(
        entry: CatalogEntry,
        diagnostics: SkillGrammarDiagnostic[],
    ): Promise<SkillGrammarRule[]> {
        const rules: SkillGrammarRule[] = [];
        for (const file of entry.revision.manifest.filter((item) =>
            item.path.toLocaleLowerCase().endsWith(".ag.json"),
        )) {
            let content: Uint8Array;
            try {
                content = await this.catalog.readFile(
                    entry.revision.identity,
                    entry.revision.revision,
                    file.path,
                );
            } catch (error) {
                diagnostics.push(
                    diagnostic(
                        "artifactRead",
                        entry.revision,
                        file.path,
                        error,
                    ),
                );
                continue;
            }
            let grammar: GrammarJson;
            try {
                grammar = JSON.parse(
                    new TextDecoder().decode(content),
                ) as GrammarJson;
            } catch (error) {
                diagnostics.push(
                    diagnostic(
                        "artifactParse",
                        entry.revision,
                        file.path,
                        error,
                    ),
                );
                continue;
            }
            try {
                const rule = {
                    id: `package:${file.path}`,
                    skill: entry.revision.identity,
                    skillRevision: entry.revision.revision,
                    schemaFingerprint: entry.revision.schemaFingerprint,
                    source: "package" as const,
                    grammar,
                };
                this.grammarIndex.buildSnapshot([rule]);
                rules.push(rule);
            } catch (error) {
                diagnostics.push(
                    diagnostic(
                        "artifactCompile",
                        entry.revision,
                        file.path,
                        error,
                    ),
                );
            }
        }
        return rules;
    }

    private matchCurrent(
        utterance: string,
        scopes?: CatalogSearchQuery["scopes"],
    ): SkillGrammarRoutingResult {
        const current = this.getCurrentSnapshot();
        return {
            snapshotId: current.snapshotId,
            outcome: this.grammarIndex.match(
                current.snapshotId,
                utterance,
                scopes,
            ),
            diagnostics: current.diagnostics,
        };
    }

    private exclusive<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.operation.then(operation, operation);
        this.operation = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
}

function diagnostic(
    code: SkillGrammarDiagnostic["code"],
    revision: SkillRevision,
    path: string,
    error: unknown,
): SkillGrammarDiagnostic {
    return {
        code,
        message: error instanceof Error ? error.message : String(error),
        skill: revision.identity,
        skillRevision: revision.revision,
        path,
    };
}
