export type ChangeKind = "feature" | "fix" | "docs" | "other";

export type Change = {
    id: string;
    area: string;
    title: string;
    kind: string;
};

export type ReleaseSection = {
    area: string;
    changes: Array<Change & { kind: ChangeKind }>;
};

const knownKinds = new Set<ChangeKind>(["feature", "fix", "docs"]);

export function normalizeKind(value: string): ChangeKind {
    return knownKinds.has(value as ChangeKind)
        ? (value as ChangeKind)
        : "other";
}

export function groupChanges(changes: Change[]): ReleaseSection[] {
    const seen = new Set<string>();
    const sections = new Map<string, ReleaseSection>();

    for (const change of changes) {
        const dedupeKey = change.title.trim().toLowerCase();
        if (seen.has(dedupeKey)) {
            continue;
        }
        seen.add(dedupeKey);

        const area = change.area.trim();
        const section = sections.get(area) ?? { area, changes: [] };
        section.changes.push({
            ...change,
            area,
            title: change.title.trim(),
            kind: normalizeKind(change.kind),
        });
        sections.set(area, section);
    }

    return [...sections.values()]
        .sort((left, right) => left.area.localeCompare(right.area))
        .map((section) => ({
            ...section,
            changes: section.changes.sort((left, right) =>
                left.id.localeCompare(right.id),
            ),
        }));
}

export function renderMarkdown(sections: ReleaseSection[]): string {
    const lines = ["# Release Notes", ""];
    for (const section of sections) {
        lines.push(
            `## ${section.area}`,
            "",
            "| ID | Kind | Change |",
            "| --- | --- | --- |",
        );
        for (const change of section.changes) {
            lines.push(`| ${change.id} | ${change.kind} | ${change.title} |`);
        }
        lines.push("");
    }
    return lines.join("\n").trimEnd() + "\n";
}

export function generateReleaseNotes(changes: Change[]): string {
    return renderMarkdown(groupChanges(changes));
}
