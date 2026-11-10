// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { check, sha256, clone } from "./quality-contract.mjs";
import {
    validatePreparationPlan,
    pinnedAsset,
    decodeUtf8,
    retainedText,
    preparationPackets,
    finishPreparation,
    relativeAssetPath,
} from "./quality-freshwiki.mjs";

export function officialQMSumSplit(path) {
    const match = /^data\/Product\/jsonl\/(train|val|test)\.jsonl$/.exec(
        relativeAssetPath(path),
    );
    check(match, "Expected official QMSum Product JSONL path");
    return match[1];
}

export function serializeQMSumTranscript(turns) {
    check(
        Array.isArray(turns) && turns.length > 0,
        "Complete nonempty meeting transcript required",
    );
    let value = "";
    const coordinateMap = [];
    const turnMap = [];
    turns.forEach((turn, index) => {
        check(
            turn && typeof turn === "object" && !Array.isArray(turn),
            "Transcript turn must be an object",
        );
        retainedText(turn.speaker, "turn speaker");
        check(
            typeof turn.content === "string" && turn.content.isWellFormed(),
            "Turn content must be well-formed text",
        );
        const start = value.length;
        value += `[${index}] `;
        for (const field of ["speaker", "content"]) {
            const retainedStart = value.length;
            value += turn[field];
            coordinateMap.push({
                coordinate: {
                    kind: "turn",
                    turn: index,
                    field,
                    start: 0,
                    end: turn[field].length,
                },
                retainedStart,
                retainedEnd: value.length,
            });
            if (field === "speaker") value += "\n";
        }
        const end = value.length;
        value += "\n\n";
        turnMap.push({ turn: index, start, end });
    });
    return { text: value, coordinateMap, turnMap };
}

export function mapQMSumSpans(spans, source, turnMap) {
    check(
        Array.isArray(spans) && spans.length > 0,
        "Specific query needs relevant spans",
    );
    return spans.map((span) => {
        check(
            Array.isArray(span) &&
                span.length === 2 &&
                span.every(
                    (bound) =>
                        (typeof bound === "number" &&
                            Number.isSafeInteger(bound)) ||
                        (typeof bound === "string" &&
                            /^(0|[1-9]\d*)$/.test(bound)),
                ),
            "Invalid inclusive turn span",
        );
        const [first, last] = span.map(Number);
        check(
            Number.isSafeInteger(first) &&
                Number.isSafeInteger(last) &&
                first >= 0 &&
                first <= last &&
                last < turnMap.length,
            "Inclusive turn span out of bounds",
        );
        const start = turnMap[first].start;
        const end = turnMap[last].end;
        return {
            sourceId: source.id,
            version: source.version,
            sha256: source.sha256,
            turnSpan: { first, last, convention: "zero-based-inclusive" },
            start,
            end,
            quote: source.text.slice(start, end),
        };
    });
}

function queryRows(meeting) {
    const rows = [];
    for (const family of ["general", "specific"]) {
        const list = meeting[`${family}_query_list`];
        check(Array.isArray(list), `${family} query list required`);
        list.forEach((query, index) => {
            check(
                query && typeof query === "object" && !Array.isArray(query),
                "Meeting query must be an object",
            );
            retainedText(query.query, "query");
            check(
                typeof query.answer === "string" && query.answer.isWellFormed(),
                "Reference answer required",
            );
            rows.push({ family, index, query });
        });
    }
    check(rows.length > 0, "No meeting queries");
    return rows;
}

function validateSpanEvidence(plan, assets, release) {
    check(
        plan.spanConvention?.kind === "zero-based-inclusive",
        "Pinned evidence for QMSum zero-based inclusive spans required",
    );
    check(
        plan.spanConvention.evidenceVerified === true,
        "Span convention evidence verification required",
    );
    const asset = pinnedAsset(
        assets,
        release,
        plan.spanConvention.evidencePath,
    );
    check(
        asset.sha256 === plan.spanConvention.evidenceSha256,
        "Span convention evidence hash mismatch",
    );
}

export function prepareQMSumQueries(assets, plan) {
    const release = validatePreparationPlan(plan, "qmsum-product");
    check(
        Array.isArray(release.license.underlying) &&
            release.license.underlying.length > 0,
        "Underlying QMSum meeting corpus terms review required",
    );
    validateSpanEvidence(plan, assets, release);
    const result = preparationPackets("qmsum-product", release);
    const parsed = new Map();
    for (const selected of plan.selection) {
        const officialSplit = officialQMSumSplit(selected.path);
        check(
            officialSplit ===
                (plan.custody === "development" ? "train" : "val"),
            "Official meeting split/custody mismatch; test remains unused",
        );
        const asset = pinnedAsset(assets, release, selected.path);
        if (!parsed.has(asset.path)) {
            const lines = decodeUtf8(asset.bytes)
                .replace(/^\uFEFF/, "")
                .split(/\r?\n/);
            if (lines.at(-1) === "") lines.pop();
            check(
                lines.every((line) => line.trim()),
                "Blank QMSum JSONL record",
            );
            parsed.set(
                asset.path,
                lines.map((line) => JSON.parse(line)),
            );
        }
        const meeting = parsed.get(asset.path)[selected.recordIndex];
        check(meeting, "Selected meeting record absent");
        check(
            meeting.topic_list === undefined ||
                Array.isArray(meeting.topic_list),
            "Meeting topic gold must be an array",
        );
        const transcript = serializeQMSumTranscript(
            meeting.meeting_transcripts,
        );
        const clusterId = `qmsum-product:${release.revision}:${officialSplit}:${selected.recordIndex}`;
        const source = {
            id: `${clusterId}:transcript`,
            version: release.revision,
            title: `Product meeting ${officialSplit} ${selected.recordIndex}`,
            text: transcript.text,
            sha256: sha256(Buffer.from(transcript.text, "utf8")),
            provenance: {
                repository: release.repository,
                revision: release.revision,
                path: asset.path,
                rawSha256: asset.sha256,
                recordIndex: selected.recordIndex,
                officialSplit,
                chronology: "unknown",
                titleOrigin: "adapter-context",
                license: clone(release.license),
            },
            coordinateMap: transcript.coordinateMap,
        };
        for (const { family, index, query } of queryRows(meeting)) {
            const id = `${clusterId}:${family}:${index}`;
            const witnesses =
                family === "specific"
                    ? mapQMSumSpans(
                          query.relevant_text_span,
                          source,
                          transcript.turnMap,
                      )
                    : [
                          {
                              sourceId: source.id,
                              version: source.version,
                              sha256: source.sha256,
                              start: 0,
                              end: source.text.length,
                              quote: source.text,
                          },
                      ];
            result.construction.bundles.push({
                id,
                kind: "projectBrief",
                query: query.query,
                aliases: [],
                sources: [clone(source)],
            });
            result.evaluator.cases.push({
                id,
                answer: query.answer,
                queryFamily: family,
                witnesses,
                topics: clone(meeting.topic_list ?? []),
                ...(family === "specific"
                    ? { relevantTextSpan: clone(query.relevant_text_span) }
                    : {}),
            });
            result.manifest.cases.push({
                id,
                clusterId,
                split: selected.split,
                officialSplit,
                path: asset.path,
                recordIndex: selected.recordIndex,
                rawSha256: asset.sha256,
            });
            result.availability.push({
                caseId: id,
                sourceId: source.id,
                status: "available",
                chronology: "unknown",
            });
        }
    }
    return finishPreparation(result, plan);
}

function projectGroupingEvidence(assets, plan, release) {
    const grouping = plan.projectGrouping;
    check(
        grouping?.kind === "ami-scenario-series" &&
            grouping.evidenceVerified === true,
        "Canonical briefs require verified AMI project grouping and meeting order",
    );
    const evidence = pinnedAsset(assets, release, grouping.evidencePath);
    check(
        evidence.sha256 === grouping.evidenceSha256,
        "Project grouping evidence hash mismatch",
    );
    return { path: evidence.path, sha256: evidence.sha256 };
}

function projectMeeting(assets, release, selected, source, evidence) {
    const original = pinnedAsset(assets, release, selected.meetingIdentityPath);
    const match =
        /^data\/Product\/(train|val)\/((?:ES|IS|TS)\d{4})([a-d])\.json$/.exec(
            original.path,
        );
    check(
        match && match[1] === officialQMSumSplit(selected.path),
        "Meeting identity must be a pinned original in the same official split",
    );
    const meeting = JSON.parse(decodeUtf8(original.bytes));
    const transcript = serializeQMSumTranscript(meeting.meeting_transcripts);
    check(
        transcript.text === source.text,
        "Original meeting identity does not match the selected transcript",
    );
    const projectId = `qmsum-ami-${match[2].toLowerCase()}`;
    const meetingId = `${projectId}${match[3]}`;
    const order = "abcd".indexOf(match[3]) + 1;
    return {
        projectId,
        label: match[2],
        order,
        source: {
            ...clone(source),
            id: meetingId,
            title: `AMI ${match[2]} meeting ${match[3]} (scenario order ${order})`,
            provenance: {
                ...clone(source.provenance),
                projectId,
                meetingId: `${match[2]}${match[3]}`,
                chronology: "verified-scenario-order",
                sequence: order,
                titleOrigin: "verified-meeting-identity",
                identityPath: original.path,
                identitySha256: original.sha256,
                groupingEvidence: evidence,
            },
        },
    };
}

export function prepareQMSum(assets, plan) {
    const release = validatePreparationPlan(plan, "qmsum-product");
    const evidence = projectGroupingEvidence(assets, plan, release);
    const variants = prepareQMSumQueries(assets, plan);
    const result = preparationPackets("qmsum-product", release);
    const groups = new Map();
    const variantSources = new Map(
        variants.construction.bundles.map((bundle) => [
            bundle.sources[0].provenance.recordIndex,
            bundle.sources[0],
        ]),
    );
    const identities = new Set();
    const mappings = new Map();
    for (const selected of plan.selection) {
        const source = variantSources.get(selected.recordIndex);
        check(source, "Selected meeting has no construction source");
        const meeting = projectMeeting(
            assets,
            release,
            selected,
            source,
            evidence,
        );
        check(
            !identities.has(meeting.source.id),
            "Duplicate canonical meeting identity",
        );
        identities.add(meeting.source.id);
        if (!groups.has(meeting.projectId))
            groups.set(meeting.projectId, {
                id: meeting.projectId,
                label: meeting.label,
                meetings: [],
            });
        groups.get(meeting.projectId).meetings.push(meeting);
        mappings.set(source.id, meeting);
    }
    for (const group of [...groups.values()].sort((a, b) =>
        a.id.localeCompare(b.id),
    )) {
        group.meetings.sort((a, b) => a.order - b.order);
        const sources = group.meetings.map((meeting) => meeting.source);
        result.construction.bundles.push({
            id: group.id,
            kind: "projectBrief",
            query: `Remote control design project AMI ${group.label}`,
            aliases: ["remote control", "remote controls", "remote"],
            project: {
                id: group.id,
                meetingIds: sources.map((source) => source.id),
            },
            sources,
        });
        result.manifest.cases.push({
            id: group.id,
            clusterId: group.id,
            split:
                plan.custody === "development" ? "development" : "confirmation",
            meetingIds: sources.map((source) => source.id),
            groupingEvidence: evidence,
        });
        for (const source of sources)
            result.availability.push({
                caseId: group.id,
                sourceId: source.id,
                status: "available",
                chronology: "verified-scenario-order",
            });
    }
    result.evaluator.cases = variants.evaluator.cases.map((variant) => {
        const meeting = mappings.get(variant.witnesses[0].sourceId);
        check(meeting, "Query variant has no canonical project mapping");
        return {
            ...variant,
            canonicalViewId: meeting.projectId,
            witnesses: variant.witnesses.map((witness) => ({
                ...witness,
                sourceId: meeting.source.id,
            })),
        };
    });
    result.manifest.queryVariants = result.evaluator.cases.map((variant) => ({
        id: variant.id,
        canonicalViewId: variant.canonicalViewId,
    }));
    return finishPreparation(result, plan);
}
