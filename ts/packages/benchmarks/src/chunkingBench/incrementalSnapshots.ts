// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    cp,
    lstat,
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
} from "node:fs/promises";
import path from "node:path";
import {
    beamRevisions,
    documentsFrom,
    queriesFor,
} from "../memoryBench/data.js";
import { loadProtocol, type Protocol } from "../memoryBench/protocol.js";
import {
    bytesHash,
    digest,
    list,
    object,
    readJson,
    saveJson,
    text,
} from "../memoryBench/storage.js";
import type { Query } from "../memoryBench/types.js";
import { loadNativeAnswerInput } from "./nativeAnswers.js";
import type { SourceMap } from "./retrievers.js";
import type { Dataset, Document, Question } from "./types.js";
import { loadFrozenIndexedMaps } from "./incrementalCompatibility.js";

export interface PilotQuestion {
    id: string;
    text: string;
    groupId: string;
    category: string;
    corpusId: string;
    gold: Question["gold"];
    reference?: string;
    beam?: Query;
}
export interface FrozenInput {
    dataset: "qmsum" | "beam";
    store: string;
    origin: string;
    configurationFingerprint: string;
    judgeModel: string;
    readerModel?: string;
    documents: Document[];
    identities: {
        documentId: string;
        corpusId: string;
        sourceId: string;
        map?: SourceMap;
    }[];
    questions: PilotQuestion[];
    provenance: unknown;
    protocol?: Protocol;
    qmsum?: Dataset;
}
export interface SnapshotOptions {
    dataset: "qmsum" | "beam";
    snapshot: string;
    references: string;
    protocol?: string;
    baselineAnswers?: string;
    newQueryLineage?: boolean;
    output: string;
    repo: string;
}

export async function qmsumSnapshot(
    options: SnapshotOptions,
): Promise<FrozenInput> {
    const input = await loadNativeAnswerInput({
        retrievalRun: options.snapshot,
        references: options.references,
        output: options.output,
        repo: options.repo,
    });
    const caps = object(
        await readJson(path.join(options.snapshot, "capabilities.json")),
    );
    const model = object(caps.benchmark);
    let readerModel = model.nativeAnswerModelId;
    let answerPin: unknown = null;
    if (options.baselineAnswers) {
        const baseline = object(
            await readJson(path.join(options.baselineAnswers, "manifest.json")),
        );
        if (
            baseline.retrievalFingerprint !== input.state.fingerprint ||
            baseline.datasetHash !== digest(input.dataset) ||
            baseline.referenceHash !== input.referenceHash ||
            digest(baseline.questionIds) !==
                digest(input.questions.map((q) => q.id)) ||
            object(object(baseline.capabilities).benchmark)
                .configurationFingerprint !==
                input.state.configurationFingerprint ||
            baseline.judgeModelId !== model.modelId
        )
            throw new Error(
                "QMSum answer baseline does not pin this frozen dataset/configuration/cohort",
            );
        readerModel = baseline.nativeAnswerModelId;
        answerPin = baseline;
    }
    if (typeof readerModel !== "string" && !options.newQueryLineage)
        throw new Error(
            "Frozen QMSum ingestion predates reader-model identity; supply --baseline-answers with its existing native answer manifest",
        );
    if (input.questions.length > 10)
        throw new Error("Pilot QMSum budget is at most 10 frozen questions");
    return {
        dataset: "qmsum",
        store: path.join(options.snapshot, "store"),
        origin: options.snapshot,
        configurationFingerprint: input.state.configurationFingerprint,
        judgeModel: text(model.modelId),
        ...(typeof readerModel === "string"
            ? { readerModel: text(readerModel) }
            : {}),
        documents: input.dataset.documents,
        identities: input.dataset.documents.map((doc) => ({
            documentId: doc.id,
            corpusId: input.state.corpusId,
            sourceId: input.state.sources[doc.id].sourceId,
            map: input.state.sources[doc.id],
        })),
        questions: input.questions.map((q) => ({
            ...q,
            category: "specific",
            corpusId: input.state.corpusId,
            reference: input.references.get(q.id)!,
        })),
        provenance: {
            manifest: input.manifest,
            referenceHash: input.referenceHash,
            answerPin,
        },
        qmsum: input.dataset,
    };
}

export async function beamSnapshot(
    options: SnapshotOptions,
): Promise<FrozenInput> {
    if (!options.protocol)
        throw new Error("BEAM requires its pinned official protocol file");
    const archive = object(
        await readJson(path.join(options.snapshot, "results.json")),
    );
    const manifest = object(archive.manifest);
    const state = object(
        await readJson(path.join(options.snapshot, "provider-state.json")),
    );
    const raw = await readFile(options.references);
    const rawProtocol = await readJson(options.protocol);
    const protocol = await loadProtocol(options.protocol);
    if (
        manifest.dataset !== "beam" ||
        manifest.split !== "100k" ||
        manifest.stage !== "qualification" ||
        manifest.provider !== "content" ||
        manifest.mode !== "agent" ||
        state.fingerprint !== archive.fingerprint ||
        manifest.dataRevision !== beamRevisions["Mohammadta/BEAM"] ||
        digest(manifest) !== archive.fingerprint ||
        bytesHash(raw) !== manifest.dataSha256 ||
        digest(rawProtocol) !== manifest.protocolSha256
    )
        throw new Error(
            "Incompatible BEAM qualification snapshot, dataset, or official protocol pins",
        );
    const rows = list(JSON.parse(raw.toString("utf8"))).map(object);
    const byId = new Map(queriesFor(rows).map((query) => [query.id, query]));
    const ids = list(manifest.queryIds).map(text);
    if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
        throw new Error(
            "BEAM pilot requires at most 20 unique frozen qualification IDs",
        );
    const queries = ids.map((id) => {
        const query = byId.get(id);
        const prediction = list(archive.results)
            .map(object)
            .find((row) => row.queryId === id);
        if (
            !query ||
            !prediction ||
            prediction.query !== query.query ||
            prediction.category !== query.category
        )
            throw new Error(`Frozen BEAM question/category mismatch: ${id}`);
        return query;
    });
    const units = object(state.units);
    const docs = documentsFrom(rows, new Set(queries.map((q) => q.unit)));
    const records = Object.values(object(state.documents)).map(object);
    if (
        records.length !== docs.length ||
        docs.length !== manifest.documentCount
    )
        throw new Error(
            "BEAM snapshot does not contain the full selected conversation history",
        );
    const identities = docs.map((doc) => {
        const sourceId = digest([doc.unit, doc.id]);
        const source = records.find((item) => item.sourceId === sourceId);
        if (
            !source ||
            !source.ready ||
            source.id !== doc.id ||
            source.unit !== doc.unit ||
            source.hash !==
                digest([doc.content, doc.messages, doc.timestamp]) ||
            digest(source.sourceIds) !== digest(doc.sourceIds)
        )
            throw new Error(`BEAM canonical source-map mismatch: ${doc.id}`);
        return {
            documentId: doc.id,
            sourceId,
            corpusId: text(units[doc.unit]),
        };
    });
    const model = object(object(manifest.capabilities).benchmark);
    const documents = docs.map((doc) => ({
        id: doc.id,
        text: doc.content,
        title: doc.title,
        sections: [],
    }));
    const frozenMaps = await loadFrozenIndexedMaps(
        path.join(options.snapshot, "memory"),
        { documents, identities },
    );
    return {
        dataset: "beam",
        store: path.join(options.snapshot, "memory"),
        origin: options.snapshot,
        configurationFingerprint: text(model.configurationFingerprint),
        judgeModel: text(manifest.benchmarkModel),
        ...(typeof model.nativeAnswerModelId === "string"
            ? { readerModel: model.nativeAnswerModelId }
            : {}),
        documents,
        identities: identities.map((identity) => ({
            ...identity,
            map: frozenMaps[identity.documentId],
        })),
        questions: queries.map((query) => ({
            id: query.id,
            text: query.timestamp
                ? `Reference date for interpreting relative dates: ${query.timestamp}\n${query.query}`
                : query.query,
            groupId: query.unit,
            category: query.category,
            corpusId: text(units[query.unit]),
            gold: [],
            beam: query,
        })),
        provenance: {
            manifest,
            datasetHash: bytesHash(raw),
            protocolHash: digest(rawProtocol),
            nativeUnitization:
                "persisted-original-DocParts-validated-as-exact-canonical-partition-not-current-reparse",
        },
        protocol,
    };
}

export async function rejectLinks(file: string): Promise<void> {
    const parent = path.dirname(file);
    if (parent !== file) await rejectLinks(parent);
    const info = await lstat(file).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return undefined;
        throw error;
    });
    if (info?.isSymbolicLink())
        throw new Error(
            `Snapshot paths cannot contain links/junctions: ${file}`,
        );
}

export async function treeIdentity(directory: string): Promise<string> {
    await rejectLinks(directory);
    const entries: [string, string][] = [];
    async function walk(root: string) {
        for (const entry of (await readdir(root, { withFileTypes: true })).sort(
            (a, b) => a.name.localeCompare(b.name, "en"),
        )) {
            const file = path.join(root, entry.name);
            if (entry.isSymbolicLink())
                throw new Error(
                    `Snapshot cannot contain links/junctions: ${file}`,
                );
            if (entry.isDirectory()) await walk(file);
            else if (entry.isFile())
                entries.push([
                    path.relative(directory, file),
                    bytesHash(await readFile(file)),
                ]);
            else throw new Error("Unsupported snapshot file type");
        }
    }
    await walk(directory);
    return digest(entries);
}

export function requireOutside(parent: string, child: string) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    if (
        !relative ||
        (relative !== ".." &&
            !relative.startsWith(`..${path.sep}`) &&
            !path.isAbsolute(relative))
    )
        throw new Error(
            "Experimental output must be outside source checkout and frozen snapshot",
        );
}

export async function ownExperimentRoot(directory: string, identity: unknown) {
    await rejectLinks(directory);
    const file = path.join(directory, "experiment-owner.json");
    const previous = await readJson(file);
    if (previous !== undefined) {
        if (digest(previous) !== digest(identity))
            throw new Error(
                "Experimental root ownership differs; use a NEW experiment root",
            );
        return;
    }
    const entries = await readdir(directory).catch(
        (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
        },
    );
    if (entries.length)
        throw new Error(
            "Refusing to modify an existing unowned namespace; use a NEW experiment root",
        );
    await mkdir(directory, { recursive: true });
    await saveJson(file, identity);
}

export async function cloneFrozenStore(
    source: string,
    target: string,
    hash: string,
) {
    await rejectLinks(target);
    const receipt = `${target}.snapshot.json`;
    const saved = await readJson(receipt);
    if (saved !== undefined) {
        if (digest(saved) !== digest({ source, hash }))
            throw new Error("Frozen store clone identity drift");
        if (!(await lstat(target)).isDirectory())
            throw new Error("Missing experiment store");
        return;
    }
    const exists = await lstat(target).catch(() => undefined);
    if (exists)
        throw new Error("Refusing to overwrite an unowned experiment store");
    const staging = `${target}.copying`;
    await rejectLinks(staging);
    await rm(staging, { recursive: true, force: true });
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, staging, {
        recursive: true,
        dereference: false,
        errorOnExist: true,
    });
    if (
        (await treeIdentity(staging)) !== hash ||
        (await treeIdentity(source)) !== hash
    )
        throw new Error("Frozen snapshot changed during cloning");
    await rename(staging, target);
    await saveJson(receipt, { source, hash });
}
