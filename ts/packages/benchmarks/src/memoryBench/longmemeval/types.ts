// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface OfficialQuestion {
    question_id: string;
    question_type: string;
    question: string;
    question_date: string;
    answer: string | number;
    haystack_session_ids: string[];
    haystack_dates: string[];
    haystack_sessions: {
        role: string;
        content: string;
        has_answer?: boolean;
    }[][];
    answer_session_ids: string[];
}

export interface PreparationPlan {
    provenance: {
        repository: string;
        revision: string;
        path: string;
        sha256: string;
        datasetRepository?: string;
        datasetRevision?: string;
    };
    seed: string;
    scope?: "full500";
    historyPolicy?: "official-supplied";
    quotas?: Record<string, number>;
}

export interface ConstructionCase {
    id: string;
    cutoff: string;
    sessions: {
        id: string;
        position: number;
        date: string;
        turns: { role: string; content: string }[];
    }[];
}

export interface PreparedLongMemEval {
    manifest: {
        schemaVersion: number;
        benchmark: string;
        provenance: PreparationPlan["provenance"];
        seed: string;
        quotas: Record<string, number>;
        originalRowHashes: {
            id: string;
            sha256: string;
            category: string;
        }[];
        constructionPolicy: string;
        datePolicy: string;
        sessionIdentityPolicy: string;
        timestampConflicts: {
            questionId: string;
            sessionPosition: number;
            millisecondsAfterQuestion: number;
        }[];
        sha256: string;
    };
    construction: ConstructionCase[];
    readerOnly: {
        evaluatorOnly: boolean;
        questions: Pick<
            OfficialQuestion,
            "question_id" | "question" | "question_date"
        >[];
    };
    evaluatorOnly: {
        evaluatorOnly: boolean;
        reviewStatus: string;
        references: OfficialQuestion[];
    };
}

export interface Hypothesis {
    question_id: string;
    hypothesis: string;
    status: string;
}

export interface OfficialLabel {
    question_id: string;
    autoeval_label: { label: boolean; model: string };
}
