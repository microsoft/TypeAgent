// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { ProcedureVersion } from "@typeagent/memory-service";
import {
    renderAgentEdition,
    renderAgentEditionReferences,
    validateReviewedAgentEdition,
    redactRunbookText,
} from "@typeagent/memory-service";
import type {
    SkillFileInput,
    SkillIdentity,
    SkillPackageInput,
} from "@typeagent/skill-catalog";
import {
    getProcedureLineage,
    hashArtifact,
    validateProcedure,
} from "./procedureValidation.js";
import type { ProcedureSkillOptions, SkillArtifactInput } from "./types.js";

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateSkillName(name: string): void {
    if (
        name.length > 64 ||
        !skillNamePattern.test(name) ||
        name.includes("--")
    ) {
        throw new Error(
            "Agent Skill name must be 1-64 lowercase letters, numbers, or single hyphens, and cannot start or end with a hyphen.",
        );
    }
}

function validateDescription(description: string): void {
    if (
        description.trim() !== description ||
        description.length === 0 ||
        description.length > 1024
    ) {
        throw new Error(
            "Agent Skill description must be 1-1024 characters without leading or trailing whitespace.",
        );
    }
}

function validateIdentityPart(value: string, field: string): void {
    if (
        value.trim() !== value ||
        value.length === 0 ||
        /[\u0000-\u001f]/.test(value)
    ) {
        throw new Error(`Invalid skill ${field}: ${value}`);
    }
}

function validateIdentity(identity: SkillIdentity): void {
    if (!["builtin", "user", "project", "package"].includes(identity.scope)) {
        throw new Error(`Invalid skill scope: ${identity.scope}`);
    }
    validateIdentityPart(identity.origin, "origin");
    validateIdentityPart(identity.name, "name");
}

function validateArtifactPath(path: string): void {
    if (
        path.length === 0 ||
        path.startsWith("/") ||
        path.includes("\\") ||
        /[<>:"|?*\u0000-\u001f]/.test(path) ||
        /^[A-Za-z]:/.test(path) ||
        path
            .split("/")
            .some(
                (part) =>
                    part === "" ||
                    part === "." ||
                    part === ".." ||
                    part.trim() !== part ||
                    part.endsWith(".") ||
                    /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(
                        part,
                    ),
            )
    ) {
        throw new Error(`Unsafe skill file path: ${path}`);
    }
}

function yamlString(value: string): string {
    return JSON.stringify(value);
}

function renderSkillMarkdown(
    procedure: ProcedureVersion,
    name: string,
    description: string,
): string {
    const lineage = getProcedureLineage(procedure);
    const lines = [
        "---",
        `name: ${name}`,
        `description: ${yamlString(description)}`,
        "metadata:",
        `  typeagent-corpus-id: ${yamlString(lineage.corpusId)}`,
        `  typeagent-procedure-id: ${yamlString(lineage.procedureId)}`,
        `  typeagent-procedure-version: ${yamlString(String(lineage.version))}`,
        `  typeagent-json-hash: ${yamlString(lineage.jsonHash)}`,
        `  typeagent-markdown-hash: ${yamlString(lineage.markdownHash)}`,
    ];
    if (lineage.basedOnCandidateId !== undefined) {
        lines.push(
            `  typeagent-candidate-id: ${yamlString(lineage.basedOnCandidateId)}`,
        );
    }
    if (lineage.previousVersion !== undefined) {
        lines.push(
            `  typeagent-previous-version: ${yamlString(String(lineage.previousVersion))}`,
        );
    }
    lines.push("---", "", `# ${procedure.document.title}`, "", description, "");
    const edition = procedure.document.agentEdition;
    if (edition === undefined) {
        lines.push(
            "## Procedure",
            "",
            ...procedure.document.steps.map(
                (step, index) => `${index + 1}. ${step}`,
            ),
        );
    } else {
        lines.push(renderAgentEdition(edition));
    }
    for (const section of procedure.document.additionalSections ?? []) {
        lines.push("", `## ${section.heading}`, "", section.content);
    }
    lines.push("", "## Sources", "");
    if (procedure.document.citations.length === 0) {
        lines.push("- No source citations were recorded.");
    } else {
        procedure.document.citations.forEach((citation, index) => {
            const location = citation.locator ? ` (${citation.locator})` : "";
            lines.push(
                `${index + 1}. \`${citation.sourceId}@${citation.revisionId}\`${location}`,
            );
            if (citation.excerpt) {
                lines.push(
                    `   > ${citation.excerpt.replace(/\n/g, "\n   > ")}`,
                );
            }
        });
    }
    return `${redactRunbookText(lines.join("\n"))}\n`;
}

function addArtifact(
    files: SkillFileInput[],
    artifact: SkillArtifactInput | undefined,
    defaultPath: string,
): void {
    if (artifact === undefined) return;
    const path = artifact.path ?? defaultPath;
    validateArtifactPath(path);
    if (!path.endsWith(".json")) {
        throw new Error(
            "Schema and grammar artifacts must be JSON, not scripts or executables.",
        );
    }
    JSON.parse(
        typeof artifact.content === "string"
            ? artifact.content
            : Buffer.from(artifact.content).toString("utf8"),
    );
    files.push({ path, content: artifact.content });
}

export function createSkillPackage(
    procedure: ProcedureVersion,
    options: ProcedureSkillOptions,
): SkillPackageInput {
    validateProcedure(procedure);
    validateReviewedAgentEdition(procedure);
    validateSkillName(options.identity.name);
    validateIdentity(options.identity);
    const description = redactRunbookText(
        options.description ??
            procedure.document.summary ??
            procedure.document.title,
    );
    validateDescription(description);

    const files: SkillFileInput[] = [
        {
            path: "SKILL.md",
            content: renderSkillMarkdown(
                procedure,
                options.identity.name,
                description,
            ),
        },
    ];
    if (procedure.document.agentEdition !== undefined) {
        files.push({
            path: "references/runbook.md",
            content: renderAgentEditionReferences(
                procedure.document.agentEdition,
            ),
        });
    }
    addArtifact(files, options.schema, "artifacts/schema.json");
    addArtifact(files, options.grammar, "artifacts/grammar.ag.json");
    const paths = new Set<string>();
    for (const file of files) {
        const normalizedPath = file.path.toLowerCase();
        if (paths.has(normalizedPath)) {
            throw new Error(`Duplicate skill artifact path: ${file.path}`);
        }
        paths.add(normalizedPath);
    }
    const schemaFingerprint =
        options.schema === undefined
            ? procedure.jsonHash
            : hashArtifact(options.schema.content);
    return {
        identity: structuredClone(options.identity),
        displayName: redactRunbookText(procedure.document.title),
        description,
        schemaFingerprint,
        files,
    };
}
