// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type Database from "better-sqlite3";
import {
    DomainError,
    asId,
    normalizeTerm,
    normalizeTopicPath,
    type AccessScope,
    type Artifact,
    type ArtifactChange,
    type DesignNote,
    type Goal,
    type MemoryHead,
    type MemoryRelation,
    type MemoryRevision,
    type MemoryState,
    type MemoryStateEvent,
    type MemoryUsage,
    type MemoryView,
    type Term,
    type TermAlias,
    type Topic,
    type TopicAlias,
    type TopicOutput,
    type TopicPropertyDefinition,
    type TopicPropertyValue,
    type TurnAggregate,
    canTransitionMemoryState,
    createMemoryRevision,
} from "../domain/index.js";
import {
    openDatabaseConnection,
    type OpenDatabaseOptions,
} from "./connection.js";

export type SearchDocument = {
    documentId: string;
    scopeId: string;
    entityKind: string;
    entityId: string;
    revision: number;
    title: string;
    content: string;
    occurredAt: string;
};

export type SearchPosting = SearchDocument & {
    quality: number;
    channel: "lexical" | "term";
};

export type SearchDocumentFields = Readonly<
    Record<string, string | number | boolean | readonly string[] | undefined>
>;

export type StructuralPostingSource =
    | { type: "term"; value: string }
    | { type: "artifact"; value: string }
    | { type: "turn"; value: string };

export type ChangedEntityPosting = {
    entityKind: string;
    entityId: string;
    eventReferences: readonly string[];
};

export type ProjectedSearchDocument = {
    document: SearchDocument;
    fields: SearchDocumentFields;
};

export type IdempotencyRecord = {
    scopeId: string;
    key: string;
    requestHash: string;
    resultJson: string;
    createdAt: string;
};

export type MemoryStateChange = {
    memoryId: string;
    expectedRevision?: number;
    supersededBy?: string;
    event: MemoryStateEvent;
};

export type RetrievalRecordResult = {
    entityId: string;
    entityKind: string;
    revision: number;
    score: number;
    channels: readonly string[];
};

export type MemoryFeedbackOutcome = {
    memoryId: string;
    outcome: "useful" | "unhelpful" | "unused";
    reason?: string;
};

export interface MemoryRepository extends Disposable {
    runInTransaction<T>(operation: () => T): T;
    getSchemaVersion(): number;
    getSearchIndexVersion(): number;
    getIdempotencyRecord(
        scopeId: string,
        key: string,
    ): IdempotencyRecord | undefined;
    saveIdempotencyRecord(record: IdempotencyRecord): void;
    saveScope(scope: AccessScope): void;
    saveTopic(topic: Topic): void;
    saveTopicAlias(alias: TopicAlias): void;
    saveTerm(term: Term): void;
    saveTermAlias(scopeId: string, alias: TermAlias): void;
    saveTurnAggregate(aggregate: TurnAggregate): void;
    saveArtifact(artifact: Artifact): void;
    saveArtifactChange(change: ArtifactChange): void;
    saveGoal(goal: Goal): void;
    saveDesignNote(note: DesignNote): void;
    saveTopicOutput(output: TopicOutput): void;
    savePropertyDefinition(definition: TopicPropertyDefinition): void;
    savePropertyValue(value: TopicPropertyValue): void;
    createMemory(
        revision: MemoryRevision,
        relations: readonly MemoryRelation[],
    ): MemoryView;
    reviseMemory(
        revision: MemoryRevision,
        expectedRevision: number,
    ): MemoryView;
    getMemory(
        scopeId: string,
        memoryId: string,
        revision?: number,
    ): MemoryView | undefined;
    listMemoryHistory(scopeId: string, memoryId: string): MemoryRevision[];
    changeMemoryStates(
        scopeId: string,
        changes: readonly MemoryStateChange[],
    ): MemoryView[];
    recordRetrieval(
        retrievalId: string,
        scopeId: string,
        queryJson: string,
        results: readonly RetrievalRecordResult[],
        createdAt: string,
    ): void;
    recordMemoryFeedback(
        retrievalId: string,
        outcomes: readonly MemoryFeedbackOutcome[],
        createdAt: string,
    ): MemoryUsage[];
    rebuildSearchDocuments(): number;
    listSearchDocuments(
        scopeId?: string,
        entityKinds?: readonly string[],
    ): SearchDocument[];
    searchDocuments(
        scopeId: string,
        text: string,
        entityKinds: readonly string[],
        maxResults: number,
    ): SearchPosting[];
    resolveTopicIds(
        scopeId: string,
        rootPath: string,
        traversal: "exact" | "children" | "descendants",
    ): string[];
    listTopicEntityIds(
        scopeId: string,
        topicIds: readonly string[],
        entityKind: string,
        roles?: readonly ("primary" | "secondary")[],
    ): string[];
    listSourceEntityIds(
        scopeId: string,
        source: StructuralPostingSource,
        entityKind: string,
    ): string[];
    getSearchDocumentFields(document: SearchDocument): SearchDocumentFields;
    listChangedEntityPostings(
        scopeId: string,
        entityKinds: readonly string[],
        start: string,
        end: string,
    ): ChangedEntityPosting[];
    projectSearchDocumentAt(
        document: SearchDocument,
        instant: string,
    ): ProjectedSearchDocument | undefined;
    projectSearchDocumentRevision(
        document: SearchDocument,
        revision: number,
    ): ProjectedSearchDocument | undefined;
    close(): void;
    getScope(scopeId: string): AccessScope | undefined;
    findTopicByPath(scopeId: string, path: string): Topic | undefined;
    findTerm(scopeId: string, text: string): Term | undefined;
    getArtifact(artifactId: string): Artifact | undefined;
    getGoal(goalId: string): Goal | undefined;
    getDesignNote(designNoteId: string): DesignNote | undefined;
    getTopicOutput(outputId: string): TopicOutput | undefined;
    getPropertyDefinition(
        definitionId: string,
    ): TopicPropertyDefinition | undefined;
}

type ScopeRow = { scope_id: string };
type RevisionRow = { revision: number };

type MemoryHeadRow = {
    memory_id: string;
    scope_id: string;
    current_revision: number;
    state: MemoryState;
    superseded_by: string | null;
    state_changed_at: string;
    state_reason: string | null;
};

type MemoryRevisionRow = {
    memory_id: string;
    revision: number;
    scope_id: string;
    kind: MemoryRevision["kind"];
    content: string;
    structured_content_json: string | null;
    tags_json: string;
    provenance_json: string;
    confidence: number | null;
    importance: number;
    valid_from: string | null;
    valid_until: string | null;
    reason: string | null;
    created_at: string;
};

type TopicRow = {
    topic_id: string;
    scope_id: string;
    parent_topic_id: string | null;
    slug: string;
    display_name: string;
    state: Topic["state"];
    revision: number;
    created_at: string;
    merged_into_topic_id: string | null;
};

type TermRow = {
    term_id: string;
    scope_id: string;
    canonical_text: string;
    display_text: string;
    created_at: string;
};

export class SqliteMemoryRepository implements MemoryRepository {
    readonly #database: Database.Database;

    public constructor(database: Database.Database) {
        this.#database = database;
    }

    public static open(
        filename: string,
        options?: OpenDatabaseOptions,
    ): SqliteMemoryRepository {
        return new SqliteMemoryRepository(
            openDatabaseConnection(filename, options),
        );
    }

    public runInTransaction<T>(operation: () => T): T {
        return this.#database.transaction(operation).immediate();
    }

    public getSchemaVersion(): number {
        return this.#database
            .prepare("SELECT COALESCE(MAX(version), 0) FROM schema_migrations")
            .pluck()
            .get() as number;
    }

    public getSearchIndexVersion(): number {
        return this.#database
            .prepare(
                "SELECT index_version FROM search_index_state WHERE singleton = 1",
            )
            .pluck()
            .get() as number;
    }

    public getScope(scopeId: string): AccessScope | undefined {
        const row = this.#database
            .prepare(
                `SELECT scope_id, user_id, agent_id, workspace_id, session_id
                 FROM scopes WHERE scope_id = ?`,
            )
            .get(scopeId) as
            | {
                  scope_id: string;
                  user_id: string;
                  agent_id: string | null;
                  workspace_id: string | null;
                  session_id: string | null;
              }
            | undefined;
        if (row === undefined) {
            return undefined;
        }
        return {
            scopeId: asId(row.scope_id, "Scope"),
            userId: row.user_id,
            ...(row.agent_id === null ? {} : { agentId: row.agent_id }),
            ...(row.workspace_id === null
                ? {}
                : { workspaceId: row.workspace_id }),
            ...(row.session_id === null ? {} : { sessionId: row.session_id }),
        };
    }

    public findTopicByPath(scopeId: string, path: string): Topic | undefined {
        const normalizedPath = normalizeTopicPath(path);
        const alias = this.#database
            .prepare(
                `SELECT topics.* FROM topic_aliases
                 JOIN topics USING(topic_id, scope_id)
                 WHERE topic_aliases.scope_id = ? AND topic_aliases.path = ?`,
            )
            .get(scopeId, normalizedPath) as TopicRow | undefined;
        if (alias !== undefined) {
            return mapTopic(alias);
        }

        let parentTopicId: string | null = null;
        let topic: TopicRow | undefined;
        for (const slug of normalizedPath.slice(1).split("/")) {
            topic = (
                parentTopicId === null
                    ? this.#database
                          .prepare(
                              `SELECT * FROM topics
                               WHERE scope_id = ? AND slug = ?
                                 AND parent_topic_id IS NULL`,
                          )
                          .get(scopeId, slug)
                    : this.#database
                          .prepare(
                              `SELECT * FROM topics
                               WHERE scope_id = ? AND slug = ?
                                 AND parent_topic_id = ?`,
                          )
                          .get(scopeId, slug, parentTopicId)
            ) as TopicRow | undefined;
            if (topic === undefined) {
                return undefined;
            }
            parentTopicId = topic.topic_id;
        }
        return topic === undefined ? undefined : mapTopic(topic);
    }

    public findTerm(scopeId: string, text: string): Term | undefined {
        const normalized = normalizeTerm(text);
        const row = this.#database
            .prepare(
                `SELECT terms.* FROM terms
                 WHERE terms.scope_id = ? AND terms.canonical_text = ?
                 UNION ALL
                 SELECT terms.* FROM term_aliases
                 JOIN terms USING(term_id, scope_id)
                 WHERE term_aliases.scope_id = ?
                   AND term_aliases.normalized_alias = ?
                 LIMIT 1`,
            )
            .get(scopeId, normalized, scopeId, normalized) as
            | TermRow
            | undefined;
        return row === undefined ? undefined : mapTerm(row);
    }

    public getArtifact(artifactId: string): Artifact | undefined {
        const row = this.#database
            .prepare("SELECT * FROM artifacts WHERE artifact_id = ?")
            .get(artifactId) as
            | {
                  artifact_id: string;
                  scope_id: string;
                  kind: string;
                  name: string;
                  uri: string | null;
                  state: Artifact["state"];
                  revision: number;
                  created_at: string;
              }
            | undefined;
        return row === undefined
            ? undefined
            : {
                  artifactId: asId(row.artifact_id, "Artifact"),
                  scopeId: asId(row.scope_id, "Scope"),
                  kind: row.kind,
                  name: row.name,
                  ...(row.uri === null ? {} : { uri: row.uri }),
                  state: row.state,
                  revision: row.revision,
                  createdAt: row.created_at,
              };
    }

    public getGoal(goalId: string): Goal | undefined {
        const row = this.#getRecord("goals", "goal_id", goalId);
        return row === undefined
            ? undefined
            : {
                  goalId: asId(row.goal_id as string, "Goal"),
                  scopeId: asId(row.scope_id as string, "Scope"),
                  topicId: asId(row.topic_id as string, "Topic"),
                  desiredState: row.desired_state as string,
                  state: row.state as Goal["state"],
                  revision: row.revision as number,
                  updatedByTurnId: asId(
                      row.updated_by_turn_id as string,
                      "Turn",
                  ),
                  updatedAt: row.updated_at as string,
                  provenance: JSON.parse(row.provenance_json as string),
              };
    }

    public getDesignNote(designNoteId: string): DesignNote | undefined {
        const row = this.#getRecord(
            "design_notes",
            "design_note_id",
            designNoteId,
        );
        return row === undefined
            ? undefined
            : {
                  designNoteId: asId(
                      row.design_note_id as string,
                      "DesignNote",
                  ),
                  scopeId: asId(row.scope_id as string, "Scope"),
                  topicId: asId(row.topic_id as string, "Topic"),
                  title: row.title as string,
                  body: row.body as string,
                  addressedGoalIds: (
                      JSON.parse(
                          row.addressed_goal_ids_json as string,
                      ) as string[]
                  ).map((id) => asId(id, "Goal")),
                  state: row.state as DesignNote["state"],
                  revision: row.revision as number,
                  updatedByTurnId: asId(
                      row.updated_by_turn_id as string,
                      "Turn",
                  ),
                  updatedAt: row.updated_at as string,
                  provenance: JSON.parse(row.provenance_json as string),
              };
    }

    public getTopicOutput(outputId: string): TopicOutput | undefined {
        const row = this.#getRecord("topic_outputs", "output_id", outputId);
        if (row === undefined) {
            return undefined;
        }
        const designNotes = this.#database
            .prepare(
                `SELECT design_note_id, design_note_revision
                 FROM output_design_notes WHERE output_id = ?
                 ORDER BY design_note_id, design_note_revision`,
            )
            .all(outputId) as Array<{
            design_note_id: string;
            design_note_revision: number;
        }>;
        return {
            outputId: asId(row.output_id as string, "Output"),
            scopeId: asId(row.scope_id as string, "Scope"),
            topicId: asId(row.topic_id as string, "Topic"),
            artifactId: asId(row.artifact_id as string, "Artifact"),
            state: row.state as TopicOutput["state"],
            revision: row.revision as number,
            designNotes: designNotes.map((note) => ({
                designNoteId: asId(note.design_note_id, "DesignNote"),
                revision: note.design_note_revision,
            })),
            updatedByTurnId: asId(row.updated_by_turn_id as string, "Turn"),
            updatedAt: row.updated_at as string,
            provenance: JSON.parse(row.provenance_json as string),
        };
    }

    public getPropertyDefinition(
        definitionId: string,
    ): TopicPropertyDefinition | undefined {
        const row = this.#getRecord(
            "topic_property_definitions",
            "definition_id",
            definitionId,
        );
        return row === undefined
            ? undefined
            : {
                  definitionId: asId(
                      row.definition_id as string,
                      "PropertyDefinition",
                  ),
                  scopeId: asId(row.scope_id as string, "Scope"),
                  topicId: asId(row.topic_id as string, "Topic"),
                  name: row.name as string,
                  valueType:
                      row.value_type as TopicPropertyDefinition["valueType"],
                  required: row.required === 1,
                  ...(row.allowed_values_json === null
                      ? {}
                      : {
                            allowedValues: JSON.parse(
                                row.allowed_values_json as string,
                            ),
                        }),
                  revision: row.revision as number,
              };
    }

    public getIdempotencyRecord(
        scopeId: string,
        key: string,
    ): IdempotencyRecord | undefined {
        const row = this.#database
            .prepare(
                `SELECT scope_id, idempotency_key, request_hash, result_json, created_at
                 FROM idempotency_records
                 WHERE scope_id = ? AND idempotency_key = ?`,
            )
            .get(scopeId, key) as
            | {
                  scope_id: string;
                  idempotency_key: string;
                  request_hash: string;
                  result_json: string;
                  created_at: string;
              }
            | undefined;
        return row === undefined
            ? undefined
            : {
                  scopeId: row.scope_id,
                  key: row.idempotency_key,
                  requestHash: row.request_hash,
                  resultJson: row.result_json,
                  createdAt: row.created_at,
              };
    }

    public saveIdempotencyRecord(record: IdempotencyRecord): void {
        this.#transaction(() => {
            this.#requireScope(record.scopeId);
            this.#database
                .prepare(
                    `INSERT INTO idempotency_records(
                        scope_id, idempotency_key, request_hash, result_json, created_at
                     ) VALUES (?, ?, ?, ?, ?)`,
                )
                .run(
                    record.scopeId,
                    record.key,
                    record.requestHash,
                    record.resultJson,
                    record.createdAt,
                );
        });
    }

    public saveScope(scope: AccessScope): void {
        this.#transaction(() => {
            this.#database
                .prepare(
                    `INSERT INTO scopes(scope_id, user_id, agent_id, workspace_id, session_id)
                     VALUES (?, ?, ?, ?, ?)`,
                )
                .run(
                    scope.scopeId,
                    scope.userId,
                    scope.agentId ?? null,
                    scope.workspaceId ?? null,
                    scope.sessionId ?? null,
                );
        });
    }

    public saveTopic(topic: Topic): void {
        this.#transaction(() => {
            this.#requireScope(topic.scopeId);
            if (topic.parentTopicId !== undefined) {
                this.#requireEntityScope(
                    "topics",
                    "topic_id",
                    topic.parentTopicId,
                    topic.scopeId,
                );
            }
            if (topic.mergedIntoTopicId !== undefined) {
                this.#requireEntityScope(
                    "topics",
                    "topic_id",
                    topic.mergedIntoTopicId,
                    topic.scopeId,
                );
            }
            this.#database
                .prepare(
                    `INSERT INTO topics(
                        topic_id, scope_id, parent_topic_id, slug, display_name,
                        state, revision, created_at, merged_into_topic_id
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    topic.topicId,
                    topic.scopeId,
                    topic.parentTopicId ?? null,
                    topic.slug,
                    topic.displayName,
                    topic.state,
                    topic.revision,
                    topic.createdAt,
                    topic.mergedIntoTopicId ?? null,
                );
        });
    }

    public saveTopicAlias(alias: TopicAlias): void {
        this.#transaction(() => {
            this.#requireEntityScope(
                "topics",
                "topic_id",
                alias.topicId,
                alias.scopeId,
            );
            this.#database
                .prepare(
                    `INSERT INTO topic_aliases(scope_id, path, topic_id, created_at)
                     VALUES (?, ?, ?, ?)`,
                )
                .run(alias.scopeId, alias.path, alias.topicId, alias.createdAt);
        });
    }

    public saveTerm(term: Term): void {
        this.#transaction(() => {
            this.#requireScope(term.scopeId);
            this.#database
                .prepare(
                    `INSERT INTO terms(
                        term_id, scope_id, canonical_text, display_text, created_at
                     ) VALUES (?, ?, ?, ?, ?)`,
                )
                .run(
                    term.termId,
                    term.scopeId,
                    term.canonicalText,
                    term.displayText,
                    term.createdAt,
                );
        });
    }

    public saveTermAlias(scopeId: string, alias: TermAlias): void {
        this.#transaction(() => {
            this.#requireEntityScope("terms", "term_id", alias.termId, scopeId);
            this.#database
                .prepare(
                    `INSERT INTO term_aliases(
                        scope_id, normalized_alias, term_id, display_alias, created_at
                     ) VALUES (?, ?, ?, ?, ?)`,
                )
                .run(
                    scopeId,
                    alias.normalizedAlias,
                    alias.termId,
                    alias.displayAlias,
                    alias.createdAt,
                );
        });
    }

    public saveTurnAggregate(aggregate: TurnAggregate): void {
        this.#transaction(() => {
            const { turn } = aggregate;
            this.#requireScope(turn.scopeId);
            const primaryCount = aggregate.topics.filter(
                (topic) => topic.role === "primary",
            ).length;
            if (primaryCount !== 1) {
                throw new DomainError(
                    "INVARIANT_VIOLATION",
                    "Turn must have one primary topic",
                    { turnId: turn.turnId, primaryTopicCount: primaryCount },
                );
            }
            for (const topic of aggregate.topics) {
                this.#requireEntityScope(
                    "topics",
                    "topic_id",
                    topic.topicId,
                    turn.scopeId,
                );
            }
            for (const term of aggregate.terms) {
                this.#requireEntityScope(
                    "terms",
                    "term_id",
                    term.termId,
                    turn.scopeId,
                );
            }

            this.#database
                .prepare(
                    `INSERT INTO turns(
                        turn_id, scope_id, conversation_id, sequence,
                        request_summary, outcome_summary, occurred_at,
                        recorded_at, provenance_json
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    turn.turnId,
                    turn.scopeId,
                    turn.conversationId,
                    turn.sequence,
                    turn.requestSummary,
                    turn.outcomeSummary,
                    turn.occurredAt,
                    turn.recordedAt,
                    JSON.stringify(turn.provenance),
                );

            const insertTopic = this.#database.prepare(
                `INSERT INTO turn_topics(turn_id, topic_id, scope_id, role)
                 VALUES (?, ?, ?, ?)`,
            );
            for (const topic of aggregate.topics) {
                insertTopic.run(
                    turn.turnId,
                    topic.topicId,
                    turn.scopeId,
                    topic.role,
                );
            }

            const insertTerm = this.#database.prepare(
                "INSERT INTO turn_terms(turn_id, term_id, role) VALUES (?, ?, ?)",
            );
            for (const term of aggregate.terms) {
                insertTerm.run(turn.turnId, term.termId, term.role ?? null);
            }

            const insertAction = this.#database.prepare(`
                INSERT INTO actions(
                    action_id, turn_id, sequence, name, summary, status,
                    tool_name, affected_goal_ids_json,
                    affected_artifact_ids_json, affected_output_ids_json,
                    design_note_ids_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (const action of aggregate.actions) {
                insertAction.run(
                    action.actionId,
                    turn.turnId,
                    action.sequence,
                    action.name,
                    action.summary,
                    action.status,
                    action.toolName ?? null,
                    JSON.stringify(action.affectedGoalIds),
                    JSON.stringify(action.affectedArtifactIds),
                    JSON.stringify(action.affectedOutputIds),
                    JSON.stringify(action.designNoteIds),
                );
            }
        });
    }

    public saveArtifact(artifact: Artifact): void {
        this.#transaction(() => {
            this.#requireScope(artifact.scopeId);
            const existing = this.getArtifact(artifact.artifactId);
            if (
                existing !== undefined &&
                existing.scopeId !== artifact.scopeId
            ) {
                this.#scopeMismatch(artifact.artifactId, artifact.scopeId);
            }
            this.#writeRevisionedFacet(
                "artifacts",
                "artifact_id",
                artifact.artifactId,
                artifact.revision,
                () => {
                    this.#database
                        .prepare(
                            `INSERT INTO artifacts(
                                artifact_id, scope_id, kind, name, uri,
                                state, revision, created_at
                             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(artifact_id) DO UPDATE SET
                                kind = excluded.kind, name = excluded.name,
                                uri = excluded.uri, state = excluded.state,
                                revision = excluded.revision`,
                        )
                        .run(
                            artifact.artifactId,
                            artifact.scopeId,
                            artifact.kind,
                            artifact.name,
                            artifact.uri ?? null,
                            artifact.state,
                            artifact.revision,
                            artifact.createdAt,
                        );
                },
            );
        });
    }

    public saveArtifactChange(change: ArtifactChange): void {
        this.#transaction(() => {
            const artifact = this.#requireRevision(
                "artifacts",
                "artifact_id",
                change.artifactId,
                change.artifactRevision,
            );
            const turnScope = this.#requireEntity(
                "turns",
                "turn_id",
                change.turnId,
            );
            if (artifact.scope_id !== turnScope.scope_id) {
                this.#scopeMismatch(change.artifactId, change.turnId);
            }
            this.#database
                .prepare(
                    `INSERT INTO artifact_changes(
                        artifact_id, turn_id, kind, summary, occurred_at,
                        artifact_revision, provenance_json
                     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    change.artifactId,
                    change.turnId,
                    change.kind,
                    change.summary,
                    change.occurredAt,
                    change.artifactRevision,
                    JSON.stringify(change.provenance),
                );
        });
    }

    public saveGoal(goal: Goal): void {
        this.#transaction(() => {
            this.#requireFacetReferences(
                goal.scopeId,
                goal.topicId,
                goal.updatedByTurnId,
            );
            this.#writeRevisionedFacet(
                "goals",
                "goal_id",
                goal.goalId,
                goal.revision,
                () => {
                    this.#database
                        .prepare(
                            `INSERT INTO goals(
                                goal_id, scope_id, topic_id, desired_state, state,
                                revision, updated_by_turn_id, updated_at, provenance_json
                             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(goal_id) DO UPDATE SET
                                desired_state = excluded.desired_state,
                                state = excluded.state,
                                revision = excluded.revision,
                                updated_by_turn_id = excluded.updated_by_turn_id,
                                updated_at = excluded.updated_at,
                                provenance_json = excluded.provenance_json`,
                        )
                        .run(
                            goal.goalId,
                            goal.scopeId,
                            goal.topicId,
                            goal.desiredState,
                            goal.state,
                            goal.revision,
                            goal.updatedByTurnId,
                            goal.updatedAt,
                            JSON.stringify(goal.provenance),
                        );
                    this.#database
                        .prepare(
                            `INSERT INTO goal_events(
                                goal_id, revision, desired_state, state,
                                updated_by_turn_id, updated_at, provenance_json
                             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        )
                        .run(
                            goal.goalId,
                            goal.revision,
                            goal.desiredState,
                            goal.state,
                            goal.updatedByTurnId,
                            goal.updatedAt,
                            JSON.stringify(goal.provenance),
                        );
                },
            );
        });
    }

    public saveDesignNote(note: DesignNote): void {
        this.#transaction(() => {
            this.#requireFacetReferences(
                note.scopeId,
                note.topicId,
                note.updatedByTurnId,
            );
            for (const goalId of note.addressedGoalIds) {
                this.#requireEntityScope(
                    "goals",
                    "goal_id",
                    goalId,
                    note.scopeId,
                );
            }
            this.#writeRevisionedFacet(
                "design_notes",
                "design_note_id",
                note.designNoteId,
                note.revision,
                () => {
                    const values = [
                        note.designNoteId,
                        note.scopeId,
                        note.topicId,
                        note.title,
                        note.body,
                        JSON.stringify(note.addressedGoalIds),
                        note.state,
                        note.revision,
                        note.updatedByTurnId,
                        note.updatedAt,
                        JSON.stringify(note.provenance),
                    ] as const;
                    this.#database
                        .prepare(
                            `INSERT INTO design_notes(
                                design_note_id, scope_id, topic_id, title, body,
                                addressed_goal_ids_json, state, revision,
                                updated_by_turn_id, updated_at, provenance_json
                             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(design_note_id) DO UPDATE SET
                                title = excluded.title, body = excluded.body,
                                addressed_goal_ids_json = excluded.addressed_goal_ids_json,
                                state = excluded.state, revision = excluded.revision,
                                updated_by_turn_id = excluded.updated_by_turn_id,
                                updated_at = excluded.updated_at,
                                provenance_json = excluded.provenance_json`,
                        )
                        .run(...values);
                    this.#database
                        .prepare(
                            `INSERT INTO design_note_revisions(
                                design_note_id, revision, title, body,
                                addressed_goal_ids_json, state,
                                updated_by_turn_id, updated_at, provenance_json
                             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        )
                        .run(
                            note.designNoteId,
                            note.revision,
                            note.title,
                            note.body,
                            JSON.stringify(note.addressedGoalIds),
                            note.state,
                            note.updatedByTurnId,
                            note.updatedAt,
                            JSON.stringify(note.provenance),
                        );
                },
            );
        });
    }

    public saveTopicOutput(output: TopicOutput): void {
        this.#transaction(() => {
            this.#requireFacetReferences(
                output.scopeId,
                output.topicId,
                output.updatedByTurnId,
            );
            this.#requireEntityScope(
                "artifacts",
                "artifact_id",
                output.artifactId,
                output.scopeId,
            );
            for (const note of output.designNotes) {
                const row = this.#requireEntity(
                    "design_note_revisions",
                    "design_note_id",
                    note.designNoteId,
                    "revision = ?",
                    note.revision,
                );
                const current = this.#requireEntity(
                    "design_notes",
                    "design_note_id",
                    note.designNoteId,
                );
                if (
                    current.scope_id !== output.scopeId ||
                    current.topic_id !== output.topicId
                ) {
                    this.#scopeMismatch(output.outputId, note.designNoteId);
                }
                void row;
            }
            this.#writeRevisionedFacet(
                "topic_outputs",
                "output_id",
                output.outputId,
                output.revision,
                () => {
                    this.#database
                        .prepare(
                            "DELETE FROM output_design_notes WHERE output_id = ?",
                        )
                        .run(output.outputId);
                    this.#database
                        .prepare(
                            `INSERT INTO topic_outputs(
                                output_id, scope_id, topic_id, artifact_id, state,
                                revision, updated_by_turn_id, updated_at, provenance_json
                             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON CONFLICT(output_id) DO UPDATE SET
                                artifact_id = excluded.artifact_id,
                                state = excluded.state, revision = excluded.revision,
                                updated_by_turn_id = excluded.updated_by_turn_id,
                                updated_at = excluded.updated_at,
                                provenance_json = excluded.provenance_json`,
                        )
                        .run(
                            output.outputId,
                            output.scopeId,
                            output.topicId,
                            output.artifactId,
                            output.state,
                            output.revision,
                            output.updatedByTurnId,
                            output.updatedAt,
                            JSON.stringify(output.provenance),
                        );
                    const insertNote = this.#database.prepare(
                        `INSERT INTO output_design_notes(
                            output_id, output_revision,
                            design_note_id, design_note_revision
                         ) VALUES (?, ?, ?, ?)`,
                    );
                    for (const note of output.designNotes) {
                        insertNote.run(
                            output.outputId,
                            output.revision,
                            note.designNoteId,
                            note.revision,
                        );
                    }
                },
            );
        });
    }

    public savePropertyDefinition(definition: TopicPropertyDefinition): void {
        this.#transaction(() => {
            this.#requireEntityScope(
                "topics",
                "topic_id",
                definition.topicId,
                definition.scopeId,
            );
            this.#database
                .prepare(
                    `INSERT INTO topic_property_definitions(
                        definition_id, scope_id, topic_id, name, value_type,
                        required, allowed_values_json, revision
                     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                    definition.definitionId,
                    definition.scopeId,
                    definition.topicId,
                    definition.name,
                    definition.valueType,
                    definition.required ? 1 : 0,
                    definition.allowedValues === undefined
                        ? null
                        : JSON.stringify(definition.allowedValues),
                    definition.revision,
                );
        });
    }

    public savePropertyValue(value: TopicPropertyValue): void {
        this.#transaction(() => {
            const definition = this.#requireRevision(
                "topic_property_definitions",
                "definition_id",
                value.definitionId,
                value.definitionRevision,
            );
            if (definition.topic_id !== value.topicId) {
                this.#scopeMismatch(value.definitionId, value.topicId);
            }
            this.#requireEntityScope(
                "turns",
                "turn_id",
                value.updatedByTurnId,
                definition.scope_id as string,
            );
            this.#database
                .prepare(
                    `INSERT INTO topic_property_values(
                        definition_id, topic_id, value_json, definition_revision,
                        updated_by_turn_id, updated_at
                     ) VALUES (?, ?, ?, ?, ?, ?)
                     ON CONFLICT(definition_id, topic_id) DO UPDATE SET
                        value_json = excluded.value_json,
                        definition_revision = excluded.definition_revision,
                        updated_by_turn_id = excluded.updated_by_turn_id,
                        updated_at = excluded.updated_at`,
                )
                .run(
                    value.definitionId,
                    value.topicId,
                    JSON.stringify(value.value),
                    value.definitionRevision,
                    value.updatedByTurnId,
                    value.updatedAt,
                );
        });
    }

    public createMemory(
        revision: MemoryRevision,
        relations: readonly MemoryRelation[],
    ): MemoryView {
        return this.#transaction(() => {
            this.#requireScope(revision.scopeId);
            if (revision.revision !== 1) {
                throw new DomainError(
                    "REVISION_CONFLICT",
                    "New memory revision must be 1",
                );
            }
            if (this.#getMemoryHeadRow(revision.memoryId) !== undefined) {
                throw new DomainError(
                    "REVISION_CONFLICT",
                    "Memory already exists",
                );
            }
            this.#insertMemoryRevision(revision);
            this.#database
                .prepare(
                    `INSERT INTO memory_heads(
                        memory_id, scope_id, current_revision, state,
                        state_changed_at
                     ) VALUES (?, ?, 1, 'active', ?)`,
                )
                .run(revision.memoryId, revision.scopeId, revision.createdAt);
            this.#database
                .prepare("INSERT INTO memory_usage(memory_id) VALUES (?)")
                .run(revision.memoryId);
            this.#insertMemoryRelations(revision, relations);
            return this.#requireMemoryView(revision.scopeId, revision.memoryId);
        });
    }

    public reviseMemory(
        revision: MemoryRevision,
        expectedRevision: number,
    ): MemoryView {
        return this.#transaction(() => {
            const head = this.#requireMemoryHeadRow(
                revision.scopeId,
                revision.memoryId,
            );
            if (head.current_revision !== expectedRevision) {
                throw new DomainError(
                    "REVISION_CONFLICT",
                    "Memory revision changed",
                    {
                        memoryId: revision.memoryId,
                        expectedRevision,
                        actualRevision: head.current_revision,
                    },
                );
            }
            if (revision.revision !== expectedRevision + 1) {
                throw new DomainError(
                    "REVISION_CONFLICT",
                    "New memory revision is not the next revision",
                );
            }
            this.#insertMemoryRevision(revision);
            this.#database
                .prepare(
                    `UPDATE memory_heads SET current_revision = ?
                     WHERE memory_id = ? AND scope_id = ?`,
                )
                .run(revision.revision, revision.memoryId, revision.scopeId);
            return this.#requireMemoryView(revision.scopeId, revision.memoryId);
        });
    }

    public getMemory(
        scopeId: string,
        memoryId: string,
        revision?: number,
    ): MemoryView | undefined {
        const head = this.#getMemoryHeadRow(memoryId);
        if (head === undefined || head.scope_id !== scopeId) {
            return undefined;
        }
        const selectedRevision = revision ?? head.current_revision;
        const revisionRow = this.#database
            .prepare(
                `SELECT * FROM memory_revisions
                 WHERE memory_id = ? AND revision = ? AND scope_id = ?`,
            )
            .get(memoryId, selectedRevision, scopeId) as
            | MemoryRevisionRow
            | undefined;
        return revisionRow === undefined
            ? undefined
            : this.#toMemoryView(head, revisionRow);
    }

    public listMemoryHistory(
        scopeId: string,
        memoryId: string,
    ): MemoryRevision[] {
        if (this.#requireMemoryHeadRow(scopeId, memoryId) === undefined) {
            return [];
        }
        return (
            this.#database
                .prepare(
                    `SELECT * FROM memory_revisions
                     WHERE memory_id = ? AND scope_id = ? ORDER BY revision`,
                )
                .all(memoryId, scopeId) as MemoryRevisionRow[]
        ).map(toMemoryRevision);
    }

    public changeMemoryStates(
        scopeId: string,
        changes: readonly MemoryStateChange[],
    ): MemoryView[] {
        return this.#transaction(() => {
            const heads = changes.map((change) => {
                const head = this.#requireMemoryHeadRow(
                    scopeId,
                    change.memoryId,
                );
                if (
                    change.expectedRevision !== undefined &&
                    head.current_revision !== change.expectedRevision
                ) {
                    throw new DomainError(
                        "REVISION_CONFLICT",
                        "Memory revision changed",
                        {
                            memoryId: change.memoryId,
                            expectedRevision: change.expectedRevision,
                            actualRevision: head.current_revision,
                        },
                    );
                }
                if (
                    change.event.fromState !== head.state ||
                    !canTransitionMemoryState(head.state, change.event.toState)
                ) {
                    throw new DomainError(
                        "INVALID_STATE_TRANSITION",
                        "Memory state transition is not allowed",
                    );
                }
                return head;
            });
            for (let index = 0; index < changes.length; index++) {
                const change = changes[index]!;
                const head = heads[index]!;
                this.#database
                    .prepare(
                        `UPDATE memory_heads SET state = ?, superseded_by = ?,
                            state_changed_at = ?, state_reason = ?
                         WHERE memory_id = ?`,
                    )
                    .run(
                        change.event.toState,
                        change.supersededBy ?? null,
                        change.event.createdAt,
                        change.event.reason,
                        change.memoryId,
                    );
                this.#database
                    .prepare(
                        `INSERT INTO memory_state_events(
                            event_id, memory_id, from_state, to_state, actor_id,
                            reason, created_at
                         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    )
                    .run(
                        change.event.eventId,
                        change.memoryId,
                        head.state,
                        change.event.toState,
                        change.event.actorId,
                        change.event.reason,
                        change.event.createdAt,
                    );
            }
            return changes.map((change) =>
                this.#requireMemoryView(scopeId, change.memoryId),
            );
        });
    }

    public recordRetrieval(
        retrievalId: string,
        scopeId: string,
        queryJson: string,
        results: readonly RetrievalRecordResult[],
        createdAt: string,
    ): void {
        this.#transaction(() => {
            this.#requireScope(scopeId);
            this.#database
                .prepare(
                    `INSERT INTO retrieval_events(
                        retrieval_id, scope_id, query_json, requested_at
                     ) VALUES (?, ?, ?, ?)`,
                )
                .run(retrievalId, scopeId, queryJson, createdAt);
            const findDocument = this.#database.prepare(
                `SELECT document_id FROM search_documents
                 WHERE scope_id = ? AND entity_kind = ? AND entity_id = ?
                   AND revision = ?`,
            );
            const insertResult = this.#database.prepare(
                `INSERT INTO retrieval_results(
                    retrieval_id, document_id, rank, score, channels_json
                 ) VALUES (?, ?, ?, ?, ?)`,
            );
            const updateUsage = this.#database.prepare(
                `UPDATE memory_usage SET
                    retrieval_count = retrieval_count + 1,
                    last_retrieved_at = ?
                 WHERE memory_id = ?`,
            );
            for (let rank = 0; rank < results.length; rank++) {
                const result = results[rank]!;
                const documentId = findDocument
                    .pluck()
                    .get(
                        scopeId,
                        result.entityKind,
                        result.entityId,
                        result.revision,
                    ) as string | undefined;
                if (documentId === undefined) {
                    throw new DomainError(
                        "REVISION_CONFLICT",
                        "Retrieved search document changed",
                    );
                }
                insertResult.run(
                    retrievalId,
                    documentId,
                    rank,
                    result.score,
                    JSON.stringify(result.channels),
                );
                if (result.entityKind === "memory") {
                    updateUsage.run(createdAt, result.entityId);
                }
            }
        });
    }

    public recordMemoryFeedback(
        retrievalId: string,
        outcomes: readonly MemoryFeedbackOutcome[],
        createdAt: string,
    ): MemoryUsage[] {
        return this.#transaction(() => {
            const retrieval = this.#database
                .prepare(
                    "SELECT scope_id FROM retrieval_events WHERE retrieval_id = ?",
                )
                .get(retrievalId) as { scope_id: string } | undefined;
            if (retrieval === undefined) {
                throw new DomainError("NOT_FOUND", "Retrieval was not found");
            }
            const matched = this.#database.prepare(
                `SELECT 1 FROM retrieval_results AS results
                 JOIN search_documents AS documents USING(document_id)
                 WHERE results.retrieval_id = ? AND documents.entity_kind = 'memory'
                   AND documents.entity_id = ?`,
            );
            const insert = this.#database.prepare(
                `INSERT INTO memory_feedback(
                    retrieval_id, memory_id, outcome, reason, created_at
                 ) VALUES (?, ?, ?, ?, ?)`,
            );
            const update = this.#database.prepare(
                `UPDATE memory_usage SET
                    useful_count = useful_count + ?,
                    unhelpful_count = unhelpful_count + ?,
                    last_useful_at = CASE WHEN ? = 1 THEN ? ELSE last_useful_at END
                 WHERE memory_id = ?`,
            );
            for (const outcome of outcomes) {
                if (matched.get(retrievalId, outcome.memoryId) === undefined) {
                    throw new DomainError(
                        "NOT_FOUND",
                        "Retrieved memory was not found",
                    );
                }
                insert.run(
                    retrievalId,
                    outcome.memoryId,
                    outcome.outcome,
                    outcome.reason ?? null,
                    createdAt,
                );
                const useful = outcome.outcome === "useful" ? 1 : 0;
                const unhelpful = outcome.outcome === "unhelpful" ? 1 : 0;
                update.run(
                    useful,
                    unhelpful,
                    useful,
                    createdAt,
                    outcome.memoryId,
                );
            }
            return outcomes.map(
                (outcome) =>
                    this.#requireMemoryView(
                        retrieval.scope_id,
                        outcome.memoryId,
                    ).usage,
            );
        });
    }

    public rebuildSearchDocuments(): number {
        return this.#transaction(() => {
            this.#database.exec(
                "DELETE FROM search_fts; UPDATE search_documents SET is_current = 0;",
            );
            const candidates = this.#database
                .prepare(searchCandidateSql)
                .all() as SearchCandidate[];
            const insertDocument = this.#database.prepare(`
                INSERT INTO search_documents(
                    document_id, scope_id, entity_kind, entity_id, revision,
                    title, content, occurred_at, is_current
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(document_id) DO UPDATE SET
                    title = excluded.title,
                    content = excluded.content,
                    occurred_at = excluded.occurred_at,
                    is_current = 1
            `);
            const insertFts = this.#database.prepare(
                "INSERT INTO search_fts(document_id, title, content) VALUES (?, ?, ?)",
            );
            for (const candidate of candidates) {
                const documentId = `${candidate.entity_kind}:${candidate.entity_id}:${candidate.revision}`;
                insertDocument.run(
                    documentId,
                    candidate.scope_id,
                    candidate.entity_kind,
                    candidate.entity_id,
                    candidate.revision,
                    candidate.title,
                    candidate.content,
                    candidate.occurred_at,
                );
                insertFts.run(documentId, candidate.title, candidate.content);
            }
            this.#database
                .prepare(
                    `UPDATE search_index_state
                     SET index_version = index_version + 1, updated_at = ?
                     WHERE singleton = 1`,
                )
                .run(new Date().toISOString());
            return candidates.length;
        });
    }

    public listSearchDocuments(
        scopeId?: string,
        entityKinds?: readonly string[],
    ): SearchDocument[] {
        if (entityKinds?.length === 0) {
            return [];
        }
        const conditions: string[] = ["is_current = 1"];
        const parameters: (string | number)[] = [];
        if (scopeId !== undefined) {
            conditions.push("scope_id = ?");
            parameters.push(scopeId);
        }
        if (entityKinds !== undefined) {
            conditions.push(
                `entity_kind IN (${entityKinds.map(() => "?").join(", ")})`,
            );
            parameters.push(...entityKinds);
        }
        const rows = this.#database
            .prepare(
                `SELECT document_id, scope_id, entity_kind, entity_id,
                        revision, title, content, occurred_at
                 FROM search_documents
                 WHERE ${conditions.join(" AND ")}
                 ORDER BY document_id`,
            )
            .all(...parameters) as SearchDocumentRow[];
        return rows.map((row) => ({
            documentId: row.document_id,
            scopeId: row.scope_id,
            entityKind: row.entity_kind,
            entityId: row.entity_id,
            revision: row.revision,
            title: row.title,
            content: row.content,
            occurredAt: row.occurred_at,
        }));
    }

    public searchDocuments(
        scopeId: string,
        text: string,
        entityKinds: readonly string[],
        maxResults: number,
    ): SearchPosting[] {
        if (entityKinds.length === 0 || maxResults <= 0) {
            return [];
        }
        const kindPlaceholders = entityKinds.map(() => "?").join(", ");
        const rows = this.#database
            .prepare(
                `SELECT documents.document_id, documents.scope_id,
                        documents.entity_kind, documents.entity_id,
                        documents.revision, documents.title, documents.content,
                        documents.occurred_at, bm25(search_fts) AS rank
                 FROM search_fts
                 JOIN search_documents AS documents USING(document_id)
                 WHERE search_fts MATCH ?
                                     AND documents.is_current = 1
                   AND documents.scope_id = ?
                   AND documents.entity_kind IN (${kindPlaceholders})
                 ORDER BY rank, documents.entity_id
                 LIMIT ?`,
            )
            .all(
                toFtsPhrase(text),
                scopeId,
                ...entityKinds,
                maxResults,
            ) as (SearchDocumentRow & { rank: number })[];
        return rows.map((row) => ({
            documentId: row.document_id,
            scopeId: row.scope_id,
            entityKind: row.entity_kind,
            entityId: row.entity_id,
            revision: row.revision,
            title: row.title,
            content: row.content,
            occurredAt: row.occurred_at,
            quality: 1 / (1 + Math.abs(row.rank)),
            channel: "lexical",
        }));
    }

    public resolveTopicIds(
        scopeId: string,
        rootPath: string,
        traversal: "exact" | "children" | "descendants",
    ): string[] {
        const root = this.findTopicByPath(scopeId, rootPath);
        if (root === undefined) {
            return [];
        }
        if (traversal === "exact") {
            return [root.topicId];
        }
        const recursive = traversal === "descendants" ? "RECURSIVE" : "";
        const rows = this.#database
            .prepare(
                traversal === "children"
                    ? `SELECT topic_id FROM topics
                       WHERE scope_id = ? AND parent_topic_id = ?
                       ORDER BY topic_id`
                    : `WITH ${recursive} descendants(topic_id) AS (
                              SELECT topic_id FROM topics
                              WHERE scope_id = ? AND topic_id = ?
                           UNION ALL
                           SELECT topics.topic_id FROM topics
                           JOIN descendants
                             ON topics.parent_topic_id = descendants.topic_id
                           WHERE topics.scope_id = ?
                       )
                       SELECT topic_id FROM descendants ORDER BY topic_id`,
            )
            .pluck()
            .all(
                ...(traversal === "children"
                    ? [scopeId, root.topicId]
                    : [scopeId, root.topicId, scopeId]),
            ) as string[];
        return rows;
    }

    public listTopicEntityIds(
        scopeId: string,
        topicIds: readonly string[],
        entityKind: string,
        roles?: readonly ("primary" | "secondary")[],
    ): string[] {
        if (topicIds.length === 0 || roles?.length === 0) {
            return [];
        }
        const topicPlaceholders = topicIds.map(() => "?").join(", ");
        const roleCondition =
            roles === undefined
                ? ""
                : ` AND turn_topics.role IN (${roles.map(() => "?").join(", ")})`;
        const parameters = [scopeId, ...topicIds, ...(roles ?? [])];
        const query = topicEntitySql(
            entityKind,
            topicPlaceholders,
            roleCondition,
        );
        return this.#database
            .prepare(query)
            .pluck()
            .all(...parameters) as string[];
    }

    public listSourceEntityIds(
        scopeId: string,
        source: StructuralPostingSource,
        entityKind: string,
    ): string[] {
        const query = sourceEntitySql(source.type, entityKind);
        if (query === undefined) {
            return [];
        }
        const value =
            source.type === "term"
                ? this.findTerm(scopeId, source.value)?.termId
                : source.value;
        if (value === undefined) {
            return [];
        }
        return this.#database
            .prepare(query)
            .pluck()
            .all(scopeId, value) as string[];
    }

    public getSearchDocumentFields(
        document: SearchDocument,
    ): SearchDocumentFields {
        const fields: Record<
            string,
            string | number | boolean | readonly string[] | undefined
        > = {
            entityId: document.entityId,
            entityKind: document.entityKind,
            revision: document.revision,
            occurredAt: document.occurredAt,
        };
        const details = this.#database
            .prepare(documentFieldSql(document.entityKind))
            .get(document.scopeId, document.entityId) as
            | {
                  state: string | null;
                  recorded_at: string | null;
                  property_name: string | null;
                  sequence?: number | null;
              }
            | undefined;
        if (details?.state !== null && details?.state !== undefined) {
            fields.state = details.state;
        }
        fields.recordedAt = details?.recorded_at ?? document.occurredAt;
        if (
            details?.property_name !== null &&
            details?.property_name !== undefined
        ) {
            fields.propertyName = details.property_name;
        }
        if (details?.sequence !== null && details?.sequence !== undefined) {
            fields.sequence = details.sequence;
        }
        if (document.entityKind === "memory") {
            const memory = this.getMemory(document.scopeId, document.entityId);
            if (memory !== undefined) {
                fields.kind = memory.revision.kind;
                fields.tags = memory.revision.tags;
                fields.importance = memory.revision.importance;
                fields.confidence = memory.revision.confidence;
                fields.validFrom = memory.revision.validFrom;
                fields.validUntil = memory.revision.validUntil;
            }
        }
        if (
            document.entityKind === "turn" ||
            document.entityKind === "action"
        ) {
            const roles = this.#database
                .prepare(
                    document.entityKind === "turn"
                        ? `SELECT DISTINCT role FROM turn_topics
                           WHERE scope_id = ? AND turn_id = ? ORDER BY role`
                        : `SELECT DISTINCT turn_topics.role FROM actions
                           JOIN turns USING(turn_id)
                           JOIN turn_topics USING(turn_id)
                           WHERE turns.scope_id = ? AND actions.action_id = ?
                           ORDER BY turn_topics.role`,
                )
                .pluck()
                .all(document.scopeId, document.entityId) as string[];
            fields.role = roles;
        }
        return fields;
    }

    public listChangedEntityPostings(
        scopeId: string,
        entityKinds: readonly string[],
        start: string,
        end: string,
    ): ChangedEntityPosting[] {
        if (entityKinds.length === 0) {
            return [];
        }
        const rows = this.#database.prepare(changedEntitySql).all({
            scopeId,
            entityKinds: JSON.stringify(entityKinds),
            start,
            end,
        }) as {
            entity_kind: string;
            entity_id: string;
            event_reference: string;
        }[];
        const postings = new Map<string, ChangedEntityPosting>();
        for (const row of rows) {
            const key = `${row.entity_kind}:${row.entity_id}`;
            const existing = postings.get(key);
            postings.set(key, {
                entityKind: row.entity_kind,
                entityId: row.entity_id,
                eventReferences: [
                    ...(existing?.eventReferences ?? []),
                    row.event_reference,
                ],
            });
        }
        return [...postings.values()];
    }

    public projectSearchDocumentAt(
        document: SearchDocument,
        instant: string,
    ): ProjectedSearchDocument | undefined {
        if (document.entityKind === "goal") {
            const row = this.#database
                .prepare(
                    `SELECT events.revision, events.desired_state, events.state,
                            events.updated_at
                     FROM goal_events AS events JOIN goals USING(goal_id)
                     WHERE goals.scope_id = ? AND events.goal_id = ?
                       AND events.updated_at <= ?
                     ORDER BY events.updated_at DESC, events.revision DESC
                     LIMIT 1`,
                )
                .get(document.scopeId, document.entityId, instant) as
                | {
                      revision: number;
                      desired_state: string;
                      state: string;
                      updated_at: string;
                  }
                | undefined;
            return row === undefined
                ? undefined
                : createHistoricalProjection(
                      document,
                      row.revision,
                      document.title,
                      row.desired_state,
                      row.state,
                      row.updated_at,
                  );
        }
        if (document.entityKind === "designNote") {
            const row = this.#database
                .prepare(
                    `SELECT revisions.revision, revisions.title, revisions.body,
                            revisions.state, revisions.updated_at
                     FROM design_note_revisions AS revisions
                     JOIN design_notes USING(design_note_id)
                     WHERE design_notes.scope_id = ?
                       AND revisions.design_note_id = ?
                       AND revisions.updated_at <= ?
                     ORDER BY revisions.updated_at DESC, revisions.revision DESC
                     LIMIT 1`,
                )
                .get(document.scopeId, document.entityId, instant) as
                | {
                      revision: number;
                      title: string;
                      body: string;
                      state: string;
                      updated_at: string;
                  }
                | undefined;
            return row === undefined
                ? undefined
                : createHistoricalProjection(
                      document,
                      row.revision,
                      row.title,
                      row.body,
                      row.state,
                      row.updated_at,
                  );
        }
        const fields = this.getSearchDocumentFields(document);
        const recordedAt = fields.recordedAt;
        return typeof recordedAt === "string" && recordedAt <= instant
            ? { document, fields }
            : undefined;
    }

    public projectSearchDocumentRevision(
        document: SearchDocument,
        revision: number,
    ): ProjectedSearchDocument | undefined {
        if (document.entityKind === "goal") {
            const row = this.#database
                .prepare(
                    `SELECT events.revision, events.desired_state, events.state,
                            events.updated_at
                     FROM goal_events AS events JOIN goals USING(goal_id)
                     WHERE goals.scope_id = ? AND events.goal_id = ?
                       AND events.revision = ?`,
                )
                .get(document.scopeId, document.entityId, revision) as
                | {
                      revision: number;
                      desired_state: string;
                      state: string;
                      updated_at: string;
                  }
                | undefined;
            return row === undefined
                ? undefined
                : createHistoricalProjection(
                      document,
                      row.revision,
                      document.title,
                      row.desired_state,
                      row.state,
                      row.updated_at,
                  );
        }
        if (document.entityKind === "designNote") {
            const row = this.#database
                .prepare(
                    `SELECT revisions.revision, revisions.title, revisions.body,
                            revisions.state, revisions.updated_at
                     FROM design_note_revisions AS revisions
                     JOIN design_notes USING(design_note_id)
                     WHERE design_notes.scope_id = ?
                       AND revisions.design_note_id = ?
                       AND revisions.revision = ?`,
                )
                .get(document.scopeId, document.entityId, revision) as
                | {
                      revision: number;
                      title: string;
                      body: string;
                      state: string;
                      updated_at: string;
                  }
                | undefined;
            return row === undefined
                ? undefined
                : createHistoricalProjection(
                      document,
                      row.revision,
                      row.title,
                      row.body,
                      row.state,
                      row.updated_at,
                  );
        }
        return document.revision === revision
            ? { document, fields: this.getSearchDocumentFields(document) }
            : undefined;
    }

    public close(): void {
        if (this.#database.open) {
            this.#database.close();
        }
    }

    public [Symbol.dispose](): void {
        this.close();
    }

    #insertMemoryRevision(revision: MemoryRevision): void {
        this.#database
            .prepare(
                `INSERT INTO memory_revisions(
                    memory_id, revision, scope_id, kind, content,
                    structured_content_json, tags_json, provenance_json,
                          confidence, importance, valid_from, valid_until, reason,
                          created_at
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                revision.memoryId,
                revision.revision,
                revision.scopeId,
                revision.kind,
                revision.content,
                revision.structuredContent === undefined
                    ? null
                    : JSON.stringify(revision.structuredContent),
                JSON.stringify(revision.tags),
                JSON.stringify(revision.provenance),
                revision.confidence ?? null,
                revision.importance,
                revision.validFrom ?? null,
                revision.validUntil ?? null,
                revision.reason ?? null,
                revision.createdAt,
            );
    }

    #insertMemoryRelations(
        revision: MemoryRevision,
        relations: readonly MemoryRelation[],
    ): void {
        const insert = this.#database.prepare(
            `INSERT INTO memory_relations(
                source_id, relation_type, target_id, created_at
             ) VALUES (?, ?, ?, ?)`,
        );
        for (const relation of relations) {
            if (relation.sourceMemoryId !== revision.memoryId) {
                throw new DomainError(
                    "INVARIANT_VIOLATION",
                    "Memory relation source does not match new memory",
                );
            }
            this.#requireMemoryHeadRow(
                revision.scopeId,
                relation.targetMemoryId,
            );
            insert.run(
                relation.sourceMemoryId,
                relation.relationType,
                relation.targetMemoryId,
                relation.createdAt,
            );
        }
    }

    #getMemoryHeadRow(memoryId: string): MemoryHeadRow | undefined {
        return this.#database
            .prepare("SELECT * FROM memory_heads WHERE memory_id = ?")
            .get(memoryId) as MemoryHeadRow | undefined;
    }

    #requireMemoryHeadRow(scopeId: string, memoryId: string): MemoryHeadRow {
        const head = this.#getMemoryHeadRow(memoryId);
        if (head === undefined || head.scope_id !== scopeId) {
            throw new DomainError("NOT_FOUND", "Memory was not found");
        }
        return head;
    }

    #requireMemoryView(scopeId: string, memoryId: string): MemoryView {
        const view = this.getMemory(scopeId, memoryId);
        if (view === undefined) {
            throw new DomainError(
                "INVARIANT_VIOLATION",
                "Stored memory could not be read",
            );
        }
        return view;
    }

    #toMemoryView(
        head: MemoryHeadRow,
        revisionRow: MemoryRevisionRow,
    ): MemoryView {
        const relationRows = this.#database
            .prepare(
                `SELECT source_id, relation_type, target_id, created_at
                 FROM memory_relations WHERE source_id = ?
                 ORDER BY relation_type, target_id`,
            )
            .all(head.memory_id) as {
            source_id: string;
            relation_type: MemoryRelation["relationType"];
            target_id: string;
            created_at: string;
        }[];
        const usageRow = this.#database
            .prepare("SELECT * FROM memory_usage WHERE memory_id = ?")
            .get(head.memory_id) as {
            retrieval_count: number;
            useful_count: number;
            unhelpful_count: number;
            last_retrieved_at: string | null;
            last_useful_at: string | null;
        };
        return {
            revision: toMemoryRevision(revisionRow),
            head: {
                memoryId: asId(head.memory_id, "Memory"),
                scopeId: asId(head.scope_id, "Scope"),
                currentRevision: head.current_revision,
                state: head.state,
                ...(head.superseded_by === null
                    ? {}
                    : {
                          supersededBy: asId(head.superseded_by, "Memory"),
                      }),
                stateChangedAt: head.state_changed_at,
                ...(head.state_reason === null
                    ? {}
                    : { stateReason: head.state_reason }),
            },
            relations: relationRows.map((row) => ({
                sourceMemoryId: asId(row.source_id, "Memory"),
                relationType: row.relation_type,
                targetMemoryId: asId(row.target_id, "Memory"),
                createdAt: row.created_at,
            })),
            usage: {
                memoryId: asId(head.memory_id, "Memory"),
                retrievalCount: usageRow.retrieval_count,
                usefulCount: usageRow.useful_count,
                unhelpfulCount: usageRow.unhelpful_count,
                ...(usageRow.last_retrieved_at === null
                    ? {}
                    : { lastRetrievedAt: usageRow.last_retrieved_at }),
                ...(usageRow.last_useful_at === null
                    ? {}
                    : { lastUsefulAt: usageRow.last_useful_at }),
            },
        };
    }

    #requireFacetReferences(
        scopeId: string,
        topicId: string,
        turnId: string,
    ): void {
        this.#requireEntityScope("topics", "topic_id", topicId, scopeId);
        this.#requireEntityScope("turns", "turn_id", turnId, scopeId);
    }

    #writeRevisionedFacet(
        table: string,
        idColumn: string,
        id: string,
        revision: number,
        write: () => void,
    ): void {
        const existing = this.#database
            .prepare(`SELECT revision FROM ${table} WHERE ${idColumn} = ?`)
            .get(id) as RevisionRow | undefined;
        const expected = existing === undefined ? 1 : existing.revision + 1;
        if (revision !== expected) {
            throw new DomainError(
                "REVISION_CONFLICT",
                "Facet revision changed",
                {
                    id,
                    expectedRevision: expected,
                    actualRevision: revision,
                },
            );
        }
        write();
    }

    #requireScope(scopeId: string): void {
        const row = this.#database
            .prepare("SELECT scope_id FROM scopes WHERE scope_id = ?")
            .get(scopeId) as ScopeRow | undefined;
        if (row === undefined) {
            throw new DomainError("NOT_FOUND", "Scope was not found", {
                scopeId,
            });
        }
    }

    #requireEntityScope(
        table: string,
        idColumn: string,
        id: string,
        scopeId: string,
    ): void {
        const row = this.#requireEntity(table, idColumn, id);
        if (row.scope_id !== scopeId) {
            this.#scopeMismatch(id, scopeId);
        }
    }

    #requireRevision(
        table: string,
        idColumn: string,
        id: string,
        revision: number,
    ): Record<string, string | number> {
        const row = this.#requireEntity(table, idColumn, id);
        if (row.revision !== revision) {
            throw new DomainError(
                "REVISION_CONFLICT",
                "Entity revision changed",
                {
                    id,
                    expectedRevision: revision,
                    actualRevision: row.revision,
                },
            );
        }
        return row;
    }

    #requireEntity(
        table: string,
        idColumn: string,
        id: string,
        extraPredicate?: string,
        extraValue?: string | number,
    ): Record<string, string | number> {
        const row = this.#database
            .prepare(
                `SELECT * FROM ${table} WHERE ${idColumn} = ?${
                    extraPredicate === undefined ? "" : ` AND ${extraPredicate}`
                }`,
            )
            .get(
                ...(extraPredicate === undefined ? [id] : [id, extraValue]),
            ) as Record<string, string | number> | undefined;
        if (row === undefined) {
            throw new DomainError(
                "NOT_FOUND",
                "Referenced entity was not found",
                {
                    entity: table,
                    id,
                },
            );
        }
        return row;
    }

    #getRecord(
        table: string,
        idColumn: string,
        id: string,
    ): Record<string, string | number | null> | undefined {
        return this.#database
            .prepare(`SELECT * FROM ${table} WHERE ${idColumn} = ?`)
            .get(id) as Record<string, string | number | null> | undefined;
    }

    #scopeMismatch(leftId: string, rightId: string): never {
        throw new DomainError(
            "SCOPE_MISMATCH",
            "Referenced entities have different scopes",
            {
                leftId,
                rightId,
            },
        );
    }

    #transaction<T>(operation: () => T): T {
        return this.#database.transaction(operation)();
    }
}

type SearchCandidate = {
    scope_id: string;
    entity_kind: string;
    entity_id: string;
    revision: number;
    title: string;
    content: string;
    occurred_at: string;
};

type SearchDocumentRow = SearchCandidate & { document_id: string };

function toMemoryRevision(row: MemoryRevisionRow): MemoryRevision {
    return createMemoryRevision({
        memoryId: asId(row.memory_id, "Memory"),
        scopeId: asId(row.scope_id, "Scope"),
        revision: row.revision,
        kind: row.kind,
        content: row.content,
        ...(row.structured_content_json === null
            ? {}
            : { structuredContent: JSON.parse(row.structured_content_json) }),
        tags: JSON.parse(row.tags_json) as string[],
        provenance: JSON.parse(
            row.provenance_json,
        ) as MemoryRevision["provenance"],
        ...(row.confidence === null ? {} : { confidence: row.confidence }),
        importance: row.importance,
        ...(row.valid_from === null ? {} : { validFrom: row.valid_from }),
        ...(row.valid_until === null ? {} : { validUntil: row.valid_until }),
        ...(row.reason === null ? {} : { reason: row.reason }),
        createdAt: row.created_at,
    });
}

const searchCandidateSql = `
    SELECT scope_id, 'topic' AS entity_kind, topic_id AS entity_id, revision,
           display_name AS title, slug || ' ' || display_name AS content,
           created_at AS occurred_at
    FROM topics
    UNION ALL
    SELECT scope_id, 'turn', turn_id, 1, request_summary,
           request_summary || ' ' || outcome_summary, occurred_at
    FROM turns
    UNION ALL
    SELECT scope_id, 'term', term_id, 1, display_text, canonical_text, created_at
    FROM terms
    UNION ALL
    SELECT turns.scope_id, 'action', actions.action_id, 1, actions.name,
           actions.summary || ' ' || COALESCE(actions.tool_name, ''), turns.occurred_at
    FROM actions JOIN turns USING(turn_id)
    UNION ALL
    SELECT scope_id, 'artifact', artifact_id, revision, name,
           kind || ' ' || name || ' ' || COALESCE(uri, ''), created_at
    FROM artifacts
    UNION ALL
    SELECT scope_id, 'goal', goal_id, revision, 'Goal', desired_state, updated_at
    FROM goals
    UNION ALL
    SELECT scope_id, 'designNote', design_note_id, revision, title, body, updated_at
    FROM design_notes
        UNION ALL
        SELECT topic_outputs.scope_id, 'output', topic_outputs.output_id,
            topic_outputs.revision, artifacts.name,
            artifacts.kind || ' ' || artifacts.name, topic_outputs.updated_at
        FROM topic_outputs JOIN artifacts USING(artifact_id, scope_id)
        UNION ALL
        SELECT definitions.scope_id, 'property', definitions.definition_id,
            definitions.revision, definitions.name,
                definitions.name || ' ' || property_values.value_json,
                property_values.updated_at
        FROM topic_property_definitions AS definitions
            JOIN topic_property_values AS property_values USING(definition_id, topic_id)
        UNION ALL
        SELECT heads.scope_id, 'memory', revisions.memory_id,
            revisions.revision, revisions.kind,
            revisions.content || ' ' || revisions.tags_json,
            revisions.created_at
        FROM memory_heads AS heads
        JOIN memory_revisions AS revisions
          ON revisions.memory_id = heads.memory_id
         AND revisions.revision = heads.current_revision
        WHERE heads.state = 'active'
    ORDER BY entity_kind, entity_id, revision
`;

const changedEntitySql = `
        WITH changes(entity_kind, entity_id, event_reference, changed_at) AS (
         SELECT 'topic', topic_id, topic_id || ':' || revision, created_at
         FROM topics WHERE scope_id = @scopeId
         UNION ALL
         SELECT 'turn', turn_id, turn_id, recorded_at
         FROM turns WHERE scope_id = @scopeId
         UNION ALL
         SELECT 'term', term_id, term_id, created_at
         FROM terms WHERE scope_id = @scopeId
         UNION ALL
         SELECT 'action', actions.action_id, actions.action_id, turns.recorded_at
         FROM actions JOIN turns USING(turn_id)
         WHERE turns.scope_id = @scopeId
         UNION ALL
         SELECT 'artifact', artifact_changes.artifact_id,
             artifact_changes.artifact_id || ':' || artifact_changes.turn_id,
             turns.recorded_at
         FROM artifact_changes JOIN turns USING(turn_id)
         WHERE turns.scope_id = @scopeId
         UNION ALL
         SELECT 'goal', goal_events.goal_id,
             goal_events.goal_id || ':' || goal_events.revision,
             goal_events.updated_at
         FROM goal_events JOIN goals USING(goal_id)
         WHERE goals.scope_id = @scopeId
         UNION ALL
         SELECT 'designNote', revisions.design_note_id,
             revisions.design_note_id || ':' || revisions.revision,
             revisions.updated_at
         FROM design_note_revisions AS revisions
         JOIN design_notes USING(design_note_id)
         WHERE design_notes.scope_id = @scopeId
         UNION ALL
         SELECT 'output', output_id, output_id || ':' || revision, updated_at
         FROM topic_outputs WHERE scope_id = @scopeId
         UNION ALL
         SELECT 'property', definitions.definition_id,
             definitions.definition_id || ':' || definitions.revision,
             property_values.updated_at
         FROM topic_property_definitions AS definitions
         JOIN topic_property_values AS property_values USING(definition_id, topic_id)
         WHERE definitions.scope_id = @scopeId
         UNION ALL
         SELECT 'memory', revisions.memory_id,
             revisions.memory_id || ':' || revisions.revision,
             revisions.created_at
         FROM memory_revisions AS revisions
         WHERE revisions.scope_id = @scopeId
         UNION ALL
         SELECT 'memory', heads.memory_id,
             events.event_id, events.created_at
         FROM memory_state_events AS events
         JOIN memory_heads AS heads USING(memory_id)
         WHERE heads.scope_id = @scopeId
        )
        SELECT entity_kind, entity_id, event_reference
        FROM changes
        WHERE changed_at >= @start AND changed_at < @end
          AND entity_kind IN (SELECT value FROM json_each(@entityKinds))
        ORDER BY entity_kind, entity_id, event_reference
    `;

function toFtsPhrase(text: string): string {
    return `"${text.replaceAll('"', '""')}"`;
}

function createHistoricalProjection(
    document: SearchDocument,
    revision: number,
    title: string,
    content: string,
    state: string,
    updatedAt: string,
): ProjectedSearchDocument {
    return {
        document: {
            ...document,
            revision,
            title,
            content,
            occurredAt: updatedAt,
        },
        fields: {
            entityId: document.entityId,
            entityKind: document.entityKind,
            revision,
            state,
            occurredAt: updatedAt,
            recordedAt: updatedAt,
        },
    };
}

function topicEntitySql(
    entityKind: string,
    topicPlaceholders: string,
    roleCondition: string,
): string {
    const topicFilter = `topics.scope_id = ? AND topics.topic_id IN (${topicPlaceholders})`;
    switch (entityKind) {
        case "topic":
            return `SELECT topics.topic_id FROM topics WHERE ${topicFilter} ORDER BY 1`;
        case "turn":
            return `SELECT DISTINCT turn_topics.turn_id FROM turn_topics
                    JOIN topics USING(topic_id, scope_id)
                    WHERE ${topicFilter}${roleCondition} ORDER BY 1`;
        case "term":
            return `SELECT DISTINCT turn_terms.term_id FROM turn_topics
                    JOIN topics USING(topic_id, scope_id)
                    JOIN turn_terms USING(turn_id)
                    WHERE ${topicFilter}${roleCondition} ORDER BY 1`;
        case "action":
            return `SELECT DISTINCT actions.action_id FROM turn_topics
                    JOIN topics USING(topic_id, scope_id)
                    JOIN actions USING(turn_id)
                    WHERE ${topicFilter}${roleCondition} ORDER BY 1`;
        case "artifact":
            return `SELECT DISTINCT artifact_changes.artifact_id FROM turn_topics
                    JOIN topics USING(topic_id, scope_id)
                    JOIN artifact_changes USING(turn_id)
                    WHERE ${topicFilter}${roleCondition} ORDER BY 1`;
        case "goal":
            return `SELECT goals.goal_id FROM goals JOIN topics USING(topic_id, scope_id)
                    WHERE ${topicFilter} ORDER BY 1`;
        case "designNote":
            return `SELECT design_notes.design_note_id FROM design_notes
                    JOIN topics USING(topic_id, scope_id)
                    WHERE ${topicFilter} ORDER BY 1`;
        case "output":
            return `SELECT topic_outputs.output_id FROM topic_outputs
                    JOIN topics USING(topic_id, scope_id)
                    WHERE ${topicFilter} ORDER BY 1`;
        case "property":
            return `SELECT definitions.definition_id
                    FROM topic_property_definitions AS definitions
                    JOIN topics USING(topic_id, scope_id)
                    WHERE ${topicFilter} ORDER BY 1`;
        default:
            return `SELECT topic_id FROM topics WHERE 0 AND ${topicFilter}`;
    }
}

function sourceEntitySql(
    sourceType: StructuralPostingSource["type"],
    entityKind: string,
): string | undefined {
    if (sourceType === "turn" && entityKind === "turn") {
        return `SELECT turn_id FROM turns WHERE scope_id = ? AND turn_id = ?`;
    }
    if (sourceType === "term" && entityKind === "turn") {
        return `SELECT turns.turn_id FROM turns
                JOIN turn_terms USING(turn_id)
                WHERE turns.scope_id = ? AND turn_terms.term_id = ? ORDER BY 1`;
    }
    if (sourceType === "term" && entityKind === "topic") {
        return `SELECT DISTINCT turn_topics.topic_id FROM turns
                JOIN turn_terms USING(turn_id)
                JOIN turn_topics USING(turn_id)
                WHERE turns.scope_id = ? AND turn_terms.term_id = ? ORDER BY 1`;
    }
    if (sourceType === "artifact" && entityKind === "turn") {
        return `SELECT turns.turn_id FROM turns
                JOIN artifact_changes USING(turn_id)
                JOIN artifacts USING(artifact_id, scope_id)
                WHERE turns.scope_id = ? AND artifacts.artifact_id = ? ORDER BY 1`;
    }
    return undefined;
}

function documentFieldSql(entityKind: string): string {
    switch (entityKind) {
        case "topic":
            return `SELECT state, created_at AS recorded_at, NULL AS property_name
                    FROM topics WHERE scope_id = ? AND topic_id = ?`;
        case "turn":
            return `SELECT NULL AS state, recorded_at, NULL AS property_name,
                           sequence
                    FROM turns WHERE scope_id = ? AND turn_id = ?`;
        case "action":
            return `SELECT actions.status AS state, turns.recorded_at,
                           NULL AS property_name, actions.sequence
                    FROM actions JOIN turns USING(turn_id)
                    WHERE turns.scope_id = ? AND actions.action_id = ?`;
        case "artifact":
            return `SELECT state, created_at AS recorded_at, NULL AS property_name
                    FROM artifacts WHERE scope_id = ? AND artifact_id = ?`;
        case "goal":
            return `SELECT state, updated_at AS recorded_at, NULL AS property_name
                    FROM goals WHERE scope_id = ? AND goal_id = ?`;
        case "designNote":
            return `SELECT state, updated_at AS recorded_at, NULL AS property_name
                    FROM design_notes WHERE scope_id = ? AND design_note_id = ?`;
        case "output":
            return `SELECT state, updated_at AS recorded_at, NULL AS property_name
                    FROM topic_outputs WHERE scope_id = ? AND output_id = ?`;
        case "property":
            return `SELECT NULL AS state,
                      property_values.updated_at AS recorded_at,
                           definitions.name AS property_name
                    FROM topic_property_definitions AS definitions
                  JOIN topic_property_values AS property_values
                 USING(definition_id, topic_id)
                    WHERE definitions.scope_id = ? AND definitions.definition_id = ?`;
        case "memory":
            return `SELECT heads.state, revisions.created_at AS recorded_at,
                                                     NULL AS property_name
                                        FROM memory_heads AS heads
                                        JOIN memory_revisions AS revisions
                                            ON revisions.memory_id = heads.memory_id
                                         AND revisions.revision = heads.current_revision
                                        WHERE heads.scope_id = ? AND heads.memory_id = ?`;
        default:
            return `SELECT NULL AS state, NULL AS recorded_at,
                           NULL AS property_name WHERE ? = ?`;
    }
}

function mapTopic(row: TopicRow): Topic {
    return {
        topicId: asId(row.topic_id, "Topic"),
        scopeId: asId(row.scope_id, "Scope"),
        slug: row.slug,
        displayName: row.display_name,
        state: row.state,
        revision: row.revision,
        createdAt: row.created_at,
        ...(row.parent_topic_id === null
            ? {}
            : { parentTopicId: asId(row.parent_topic_id, "Topic") }),
        ...(row.merged_into_topic_id === null
            ? {}
            : {
                  mergedIntoTopicId: asId(row.merged_into_topic_id, "Topic"),
              }),
    };
}

function mapTerm(row: TermRow): Term {
    return {
        termId: asId(row.term_id, "Term"),
        scopeId: asId(row.scope_id, "Scope"),
        canonicalText: row.canonical_text,
        displayText: row.display_text,
        createdAt: row.created_at,
    };
}
