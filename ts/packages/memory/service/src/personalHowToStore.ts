// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash, randomUUID } from "node:crypto";
import {
    mkdir,
    readFile,
    readdir,
    rename,
    rm,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
    PersonalHowToSettings,
    PersonalHowToSettingsUpdate,
    ProcedureCandidate,
    ProcedureCandidateCreateRequest,
    ProcedureDocument,
    ProcedureListRequest,
    ProcedureSaveRequest,
    ProcedureSearchMatch,
    ProcedureSearchRequest,
    ProcedureSourceCitation,
    ProcedureSummary,
    ProcedureVersion,
} from "./types.js";

interface ProcedureIndex {
    candidates: ProcedureCandidate[];
    procedures: ProcedureSummary[];
}

interface StoredVersionMetadata {
    corpusId: string;
    procedureId: string;
    version: number;
    state: "saved" | "stale" | "archived";
    createdAt: string;
    jsonHash: string;
    markdownHash: string;
    basedOnCandidateId?: string;
    previousVersion?: number;
}

const emptyIndex: ProcedureIndex = { candidates: [], procedures: [] };

function timestamp(): string {
    return new Date().toISOString();
}

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function sortJson(item: unknown): unknown {
    if (Array.isArray(item)) {
        return item.map(sortJson);
    }
    if (item !== null && typeof item === "object") {
        return Object.fromEntries(
            Object.entries(item as Record<string, unknown>)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, sortJson(child)]),
        );
    }
    return item;
}

function validateIdentifier(kind: string, value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(value)) {
        throw new Error(`Invalid ${kind} '${value}'`);
    }
}

function canonicalize(value: unknown): string {
    return `${JSON.stringify(sortJson(value), undefined, 2)}\n`;
}

async function readJson<T>(filePath: string): Promise<T | undefined> {
    try {
        return JSON.parse(await readFile(filePath, "utf8")) as T;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            const prefix = `${path.basename(filePath)}.`;
            let entries: string[];
            try {
                entries = await readdir(path.dirname(filePath));
            } catch (directoryError) {
                if (
                    (directoryError as NodeJS.ErrnoException).code === "ENOENT"
                ) {
                    return undefined;
                }
                throw directoryError;
            }
            const backup = entries
                .filter(
                    (entry) =>
                        entry.startsWith(prefix) && entry.endsWith(".bak"),
                )
                .sort()
                .at(-1);
            if (backup === undefined) {
                return undefined;
            }
            try {
                await rename(
                    path.join(path.dirname(filePath), backup),
                    filePath,
                );
            } catch (renameError) {
                if ((renameError as NodeJS.ErrnoException).code !== "ENOENT") {
                    throw renameError;
                }
            }
            return readJson<T>(filePath);
        }
        throw error;
    }
}

async function writeAtomic(filePath: string, value: string): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    const backupPath = `${filePath}.${randomUUID()}.bak`;
    await writeFile(temporaryPath, value, "utf8");
    let hasBackup = false;
    try {
        await rename(filePath, backupPath);
        hasBackup = true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            await rm(temporaryPath, { force: true });
            throw error;
        }
    }
    try {
        await rename(temporaryPath, filePath);
        if (hasBackup) {
            await rm(backupPath, { force: true });
        }
    } catch (error) {
        await rm(temporaryPath, { force: true });
        if (hasBackup) {
            await rename(backupPath, filePath);
        }
        throw error;
    }
}

function validateDocument(document: ProcedureDocument): void {
    if (document.title.trim().length === 0) {
        throw new Error("Procedure title cannot be empty");
    }
    if (
        document.steps.length === 0 ||
        document.steps.some((step) => step.trim().length === 0)
    ) {
        throw new Error("A procedure requires at least one non-empty step");
    }
    const headings = new Set<string>();
    for (const section of document.additionalSections ?? []) {
        const heading = section.heading.trim().toLowerCase();
        if (
            heading.length === 0 ||
            heading === "steps" ||
            heading === "sources" ||
            headings.has(heading)
        ) {
            throw new Error(
                `Invalid or duplicate section '${section.heading}'`,
            );
        }
        headings.add(heading);
    }
    for (const citation of document.citations) {
        validateIdentifier("source ID", citation.sourceId);
        validateIdentifier("revision ID", citation.revisionId);
    }
}

export function procedureToMarkdown(document: ProcedureDocument): string {
    validateDocument(document);
    const lines = [`# ${document.title.trim()}`, ""];
    if (document.summary !== undefined) {
        lines.push(document.summary.trim(), "");
    }
    lines.push("## Steps", "");
    document.steps.forEach((step, index) =>
        lines.push(`${index + 1}. ${step.trim()}`),
    );
    lines.push("", "## Sources", "");
    for (const citation of document.citations) {
        lines.push(`- ${JSON.stringify(sortJson(citation))}`);
    }
    if (document.citations.length === 0) {
        lines.push("_None_");
    }
    for (const section of document.additionalSections ?? []) {
        lines.push(
            "",
            `## ${section.heading.trim()}`,
            "",
            section.content.trim(),
        );
    }
    return `${lines.join("\n").trimEnd()}\n`;
}

export function procedureFromMarkdown(markdown: string): ProcedureDocument {
    const normalized = markdown.replace(/\r\n/g, "\n");
    const titleMatch = /^# ([^\n]+)\n/.exec(normalized);
    if (titleMatch === null) {
        throw new Error("Procedure Markdown must start with a level-one title");
    }
    const body = normalized.slice(titleMatch[0].length);
    const headingPattern = /^## ([^\n]+)$/gm;
    const headings = [...body.matchAll(headingPattern)];
    if (headings.length === 0) {
        throw new Error(
            "Procedure Markdown requires Steps and Sources sections",
        );
    }
    const preamble = body.slice(0, headings[0].index).trim();
    const sections = headings.map((match, index) => {
        const contentStart = (match.index ?? 0) + match[0].length;
        const contentEnd =
            index + 1 < headings.length
                ? (headings[index + 1].index ?? body.length)
                : body.length;
        return {
            heading: match[1].trim(),
            content: body.slice(contentStart, contentEnd).trim(),
        };
    });
    const stepsSection = sections.find(
        (section) => section.heading.toLowerCase() === "steps",
    );
    const sourcesSection = sections.find(
        (section) => section.heading.toLowerCase() === "sources",
    );
    if (stepsSection === undefined || sourcesSection === undefined) {
        throw new Error(
            "Procedure Markdown requires Steps and Sources sections",
        );
    }
    const steps = stepsSection.content
        .split("\n")
        .filter((line) => line.trim().length > 0)
        .map((line) => {
            const match = /^\d+[.)]\s+(.+)$/.exec(line);
            if (match === null) {
                throw new Error(`Invalid procedure step '${line}'`);
            }
            return match[1].trim();
        });
    const citations: ProcedureSourceCitation[] =
        sourcesSection.content === "_None_"
            ? []
            : sourcesSection.content
                  .split("\n")
                  .filter((line) => line.trim().length > 0)
                  .map((line) => {
                      if (!line.startsWith("- ")) {
                          throw new Error(`Invalid source citation '${line}'`);
                      }
                      return JSON.parse(
                          line.slice(2),
                      ) as ProcedureSourceCitation;
                  });
    const additionalSections = sections
        .filter(
            (section) =>
                !["steps", "sources"].includes(section.heading.toLowerCase()),
        )
        .map((section) => ({
            heading: section.heading,
            content: section.content,
        }));
    const document: ProcedureDocument = {
        title: titleMatch[1].trim(),
        ...(preamble.length === 0 ? {} : { summary: preamble }),
        steps,
        citations,
        ...(additionalSections.length === 0 ? {} : { additionalSections }),
    };
    validateDocument(document);
    return document;
}

export class PersonalHowToStore {
    public constructor(private readonly rootDirectory: string) {}

    public async getSettings(corpusId: string): Promise<PersonalHowToSettings> {
        const stored = await readJson<PersonalHowToSettings>(
            this.settingsPath(corpusId),
        );
        return structuredClone(stored ?? this.defaultSettings());
    }

    public async updateSettings(
        corpusId: string,
        update: PersonalHowToSettingsUpdate,
    ): Promise<PersonalHowToSettings> {
        const current = await this.getSettings(corpusId);
        if (current.revision !== update.expectedRevision) {
            throw new Error(
                `Personal how-to settings revision conflict: expected ${update.expectedRevision}, actual ${current.revision}`,
            );
        }
        const next: PersonalHowToSettings = {
            revision: current.revision + 1,
            updatedAt: timestamp(),
            enabled: update.enabled ?? current.enabled,
            detectCandidates:
                update.detectCandidates ?? current.detectCandidates,
            ...(update.preferences === undefined &&
            current.preferences === undefined
                ? {}
                : {
                      preferences:
                          update.preferences ?? current.preferences ?? {},
                  }),
        };
        await writeAtomic(this.settingsPath(corpusId), canonicalize(next));
        return structuredClone(next);
    }

    public async createCandidate(
        request: ProcedureCandidateCreateRequest,
    ): Promise<ProcedureCandidate> {
        validateDocument(request);
        const index = await this.readIndex(request.corpusId);
        const candidateId = request.candidateId ?? randomUUID();
        validateIdentifier("candidate ID", candidateId);
        if (
            index.candidates.some(
                (candidate) => candidate.candidateId === candidateId,
            )
        ) {
            throw new Error(
                `Procedure candidate '${candidateId}' already exists`,
            );
        }
        const createdAt = timestamp();
        const candidate: ProcedureCandidate = {
            candidateId,
            corpusId: request.corpusId,
            state: request.state ?? "detected",
            title: request.title.trim(),
            ...(request.summary === undefined
                ? {}
                : { summary: request.summary }),
            steps: structuredClone(request.steps),
            citations: structuredClone(request.citations),
            ...(request.additionalSections === undefined
                ? {}
                : {
                      additionalSections: structuredClone(
                          request.additionalSections,
                      ),
                  }),
            createdAt,
            updatedAt: createdAt,
        };
        index.candidates.push(candidate);
        await this.writeIndex(request.corpusId, index);
        return structuredClone(candidate);
    }

    public async getCandidate(
        corpusId: string,
        candidateId: string,
    ): Promise<ProcedureCandidate | undefined> {
        const candidate = (await this.readIndex(corpusId)).candidates.find(
            (item) => item.candidateId === candidateId,
        );
        return candidate === undefined ? undefined : structuredClone(candidate);
    }

    public async listCandidates(
        corpusId: string,
        states?: ProcedureCandidate["state"][],
    ): Promise<ProcedureCandidate[]> {
        return (await this.readIndex(corpusId)).candidates
            .filter(
                (candidate) =>
                    states === undefined || states.includes(candidate.state),
            )
            .sort((left, right) =>
                left.createdAt.localeCompare(right.createdAt),
            )
            .map((candidate) => structuredClone(candidate));
    }

    public async rejectCandidate(
        corpusId: string,
        candidateId: string,
    ): Promise<ProcedureCandidate> {
        const index = await this.readIndex(corpusId);
        const candidate = index.candidates.find(
            (item) => item.candidateId === candidateId,
        );
        if (candidate === undefined) {
            throw new Error(`Unknown procedure candidate '${candidateId}'`);
        }
        if (candidate.state === "saved") {
            throw new Error("A saved procedure candidate cannot be rejected");
        }
        candidate.state = "rejected";
        candidate.updatedAt = timestamp();
        await this.writeIndex(corpusId, index);
        return structuredClone(candidate);
    }

    public async save(
        request: ProcedureSaveRequest,
    ): Promise<ProcedureVersion> {
        const index = await this.readIndex(request.corpusId);
        const candidate =
            request.candidateId === undefined
                ? undefined
                : index.candidates.find(
                      (item) => item.candidateId === request.candidateId,
                  );
        if (request.candidateId !== undefined && candidate === undefined) {
            throw new Error(
                `Unknown procedure candidate '${request.candidateId}'`,
            );
        }
        if (
            Number(request.document !== undefined) +
                Number(request.markdown !== undefined) >
            1
        ) {
            throw new Error(
                "Supply either procedure JSON or Markdown, not both",
            );
        }
        const candidateDocument =
            candidate === undefined
                ? undefined
                : {
                      title: candidate.title,
                      ...(candidate.summary === undefined
                          ? {}
                          : { summary: candidate.summary }),
                      steps: candidate.steps,
                      citations: candidate.citations,
                      ...(candidate.additionalSections === undefined
                          ? {}
                          : {
                                additionalSections:
                                    candidate.additionalSections,
                            }),
                  };
        const document =
            request.markdown !== undefined
                ? procedureFromMarkdown(request.markdown)
                : structuredClone(request.document ?? candidateDocument);
        if (document === undefined) {
            throw new Error(
                "Procedure JSON, Markdown, or candidate is required",
            );
        }
        validateDocument(document);
        const procedureId =
            request.procedureId ?? request.candidateId ?? randomUUID();
        validateIdentifier("procedure ID", procedureId);
        const summary = index.procedures.find(
            (item) => item.procedureId === procedureId,
        );
        const currentVersion = summary?.latestVersion ?? 0;
        if (
            request.expectedVersion !== undefined &&
            request.expectedVersion !== currentVersion
        ) {
            throw new Error(
                `Procedure version conflict: expected ${request.expectedVersion}, actual ${currentVersion}`,
            );
        }
        const version = await this.writeVersion(
            request.corpusId,
            procedureId,
            currentVersion + 1,
            "saved",
            document,
            request.candidateId,
            currentVersion === 0 ? undefined : currentVersion,
        );
        this.setSummary(index, version);
        if (candidate !== undefined) {
            candidate.state = "saved";
            candidate.updatedAt = timestamp();
        }
        await this.writeIndex(request.corpusId, index);
        return version;
    }

    public async list(
        request: ProcedureListRequest,
    ): Promise<ProcedureSummary[]> {
        return (await this.readIndex(request.corpusId)).procedures
            .filter(
                (summary) =>
                    request.states === undefined ||
                    request.states.includes(summary.state),
            )
            .sort((left, right) => left.title.localeCompare(right.title))
            .map((summary) => structuredClone(summary));
    }

    public async get(
        corpusId: string,
        procedureId: string,
        version?: number,
    ): Promise<ProcedureVersion | undefined> {
        const summary = (await this.readIndex(corpusId)).procedures.find(
            (item) => item.procedureId === procedureId,
        );
        if (summary === undefined) {
            return undefined;
        }
        return this.readVersion(
            corpusId,
            procedureId,
            version ?? summary.latestVersion,
        );
    }

    public async search(
        request: ProcedureSearchRequest,
    ): Promise<ProcedureSearchMatch[]> {
        const query = request.query.trim().toLowerCase();
        if (query.length === 0) {
            throw new Error("Procedure search query cannot be empty");
        }
        const summaries = await this.list(request);
        const matches: ProcedureSearchMatch[] = [];
        for (const procedure of summaries) {
            const version = await this.readVersion(
                request.corpusId,
                procedure.procedureId,
                procedure.latestVersion,
            );
            const haystack = [
                version.document.title,
                version.document.summary ?? "",
                ...version.document.steps,
                ...(version.document.additionalSections ?? []).flatMap(
                    (section) => [section.heading, section.content],
                ),
            ]
                .join("\n")
                .toLowerCase();
            const occurrences = haystack.split(query).length - 1;
            if (occurrences > 0) {
                matches.push({
                    procedure,
                    version,
                    score: occurrences,
                });
            }
        }
        return matches
            .sort(
                (left, right) =>
                    right.score - left.score ||
                    left.procedure.title.localeCompare(right.procedure.title),
            )
            .slice(0, Math.max(1, Math.min(request.limit ?? 20, 100)));
    }

    public async archive(
        corpusId: string,
        procedureId: string,
        expectedVersion?: number,
    ): Promise<ProcedureVersion> {
        return this.transition(
            corpusId,
            procedureId,
            "archived",
            expectedVersion,
        );
    }

    public async markStale(
        corpusId: string,
        sourceId: string,
        activeRevisionId?: string,
    ): Promise<void> {
        const index = await this.readIndex(corpusId);
        let changed = false;
        for (const summary of index.procedures) {
            if (summary.state !== "saved") {
                continue;
            }
            const current = await this.readVersion(
                corpusId,
                summary.procedureId,
                summary.latestVersion,
            );
            const dependsOnChangedRevision = current.document.citations.some(
                (citation) =>
                    citation.sourceId === sourceId &&
                    citation.revisionId !== activeRevisionId,
            );
            if (!dependsOnChangedRevision) {
                continue;
            }
            const stale = await this.writeVersion(
                corpusId,
                summary.procedureId,
                current.version + 1,
                "stale",
                current.document,
                current.basedOnCandidateId,
                current.version,
            );
            this.setSummary(index, stale);
            changed = true;
        }
        if (changed) {
            await this.writeIndex(corpusId, index);
        }
    }

    private async transition(
        corpusId: string,
        procedureId: string,
        state: "stale" | "archived",
        expectedVersion?: number,
    ): Promise<ProcedureVersion> {
        const index = await this.readIndex(corpusId);
        const summary = index.procedures.find(
            (item) => item.procedureId === procedureId,
        );
        if (summary === undefined) {
            throw new Error(`Unknown procedure '${procedureId}'`);
        }
        if (
            expectedVersion !== undefined &&
            expectedVersion !== summary.latestVersion
        ) {
            throw new Error(
                `Procedure version conflict: expected ${expectedVersion}, actual ${summary.latestVersion}`,
            );
        }
        const current = await this.readVersion(
            corpusId,
            procedureId,
            summary.latestVersion,
        );
        const next = await this.writeVersion(
            corpusId,
            procedureId,
            current.version + 1,
            state,
            current.document,
            current.basedOnCandidateId,
            current.version,
        );
        this.setSummary(index, next);
        await this.writeIndex(corpusId, index);
        return next;
    }

    private async writeVersion(
        corpusId: string,
        procedureId: string,
        version: number,
        state: "saved" | "stale" | "archived",
        document: ProcedureDocument,
        basedOnCandidateId?: string,
        previousVersion?: number,
    ): Promise<ProcedureVersion> {
        const canonicalJson = canonicalize(document);
        const markdown = procedureToMarkdown(document);
        const createdAt = timestamp();
        const metadata: StoredVersionMetadata = {
            corpusId,
            procedureId,
            version,
            state,
            createdAt,
            jsonHash: hash(canonicalJson),
            markdownHash: hash(markdown),
            ...(basedOnCandidateId === undefined ? {} : { basedOnCandidateId }),
            ...(previousVersion === undefined ? {} : { previousVersion }),
        };
        const versionDirectory = this.versionDirectory(
            corpusId,
            procedureId,
            version,
        );
        const stagingDirectory = `${versionDirectory}.${randomUUID()}.tmp`;
        await rm(versionDirectory, { recursive: true, force: true });
        await mkdir(stagingDirectory, { recursive: true });
        try {
            await Promise.all([
                writeFile(
                    path.join(stagingDirectory, "procedure.json"),
                    canonicalJson,
                    "utf8",
                ),
                writeFile(
                    path.join(stagingDirectory, "procedure.md"),
                    markdown,
                    "utf8",
                ),
                writeFile(
                    path.join(stagingDirectory, "version.json"),
                    canonicalize(metadata),
                    "utf8",
                ),
            ]);
            await mkdir(path.dirname(versionDirectory), { recursive: true });
            await rename(stagingDirectory, versionDirectory);
        } catch (error) {
            await rm(stagingDirectory, { recursive: true, force: true });
            throw error;
        }
        return {
            ...metadata,
            document: structuredClone(document),
            canonicalJson,
            markdown,
        };
    }

    private async readVersion(
        corpusId: string,
        procedureId: string,
        version: number,
    ): Promise<ProcedureVersion> {
        const directory = this.versionDirectory(corpusId, procedureId, version);
        const [json, markdown, metadata] = await Promise.all([
            readFile(path.join(directory, "procedure.json"), "utf8"),
            readFile(path.join(directory, "procedure.md"), "utf8"),
            readJson<StoredVersionMetadata>(
                path.join(directory, "version.json"),
            ),
        ]);
        if (
            metadata === undefined ||
            metadata.corpusId !== corpusId ||
            metadata.procedureId !== procedureId ||
            metadata.version !== version ||
            metadata.jsonHash !== hash(json) ||
            metadata.markdownHash !== hash(markdown)
        ) {
            throw new Error(
                `Procedure '${procedureId}' version ${version} is corrupt`,
            );
        }
        const document = JSON.parse(json) as ProcedureDocument;
        validateDocument(document);
        if (procedureToMarkdown(document) !== markdown) {
            throw new Error(
                `Procedure '${procedureId}' version ${version} projections do not match`,
            );
        }
        return { ...metadata, document, canonicalJson: json, markdown };
    }

    private setSummary(index: ProcedureIndex, version: ProcedureVersion): void {
        const next: ProcedureSummary = {
            corpusId: version.corpusId,
            procedureId: version.procedureId,
            title: version.document.title,
            state: version.state,
            latestVersion: version.version,
            updatedAt: version.createdAt,
        };
        index.procedures = [
            ...index.procedures.filter(
                (item) => item.procedureId !== version.procedureId,
            ),
            next,
        ];
    }

    private async readIndex(corpusId: string): Promise<ProcedureIndex> {
        return structuredClone(
            (await readJson<ProcedureIndex>(this.indexPath(corpusId))) ??
                emptyIndex,
        );
    }

    private writeIndex(corpusId: string, index: ProcedureIndex): Promise<void> {
        return writeAtomic(this.indexPath(corpusId), canonicalize(index));
    }

    private defaultSettings(): PersonalHowToSettings {
        return {
            revision: 0,
            updatedAt: new Date(0).toISOString(),
            enabled: true,
            detectCandidates: true,
        };
    }

    private howToDirectory(corpusId: string): string {
        return path.join(this.rootDirectory, corpusId, "personal-how-to");
    }

    private settingsPath(corpusId: string): string {
        return path.join(this.howToDirectory(corpusId), "settings.json");
    }

    private indexPath(corpusId: string): string {
        return path.join(this.howToDirectory(corpusId), "index.json");
    }

    private versionDirectory(
        corpusId: string,
        procedureId: string,
        version: number,
    ): string {
        return path.join(
            this.howToDirectory(corpusId),
            "procedures",
            procedureId,
            "versions",
            String(version).padStart(8, "0"),
        );
    }
}
