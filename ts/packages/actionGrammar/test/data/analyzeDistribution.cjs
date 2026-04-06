// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Analyze the distribution of vocabulary and sentence structures
 * in real NLU datasets (SNIPS + MASSIVE) to inform grammar generation.
 *
 * Run: node test/data/analyzeDistribution.cjs
 */

const fs = require("fs");
const path = require("path");

// ── SNIPS Analysis ──────────────────────────────────────────────────────

function analyzeSnips() {
    console.log("══════════════════════════════════════════════════════════");
    console.log("  SNIPS NLU Benchmark — PlayMusic + AddToPlaylist");
    console.log("══════════════════════════════════════════════════════════\n");

    const datasets = [
        { file: "snips_PlayMusic_train.json", key: "PlayMusic" },
        { file: "snips_AddToPlaylist_train.json", key: "AddToPlaylist" },
    ];

    for (const ds of datasets) {
        const filePath = path.resolve(__dirname, ds.file);
        if (!fs.existsSync(filePath)) {
            console.log(`  ${ds.key}: file not found, skipping`);
            continue;
        }
        const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        const entries = raw[ds.key];

        // Reconstruct full utterances
        const utterances = entries.map((entry) =>
            entry.data.map((d) => d.text).join(""),
        );

        // Extract structural templates (replace entity values with slot names)
        const templates = entries.map((entry) =>
            entry.data
                .map((d) => (d.entity ? `[${d.entity}]` : d.text))
                .join(""),
        );

        console.log(`── ${ds.key} (${utterances.length} utterances) ──\n`);

        // 1. Leading verb/phrase distribution
        const leadingWords = {};
        const leadingBigrams = {};
        const leadingTrigrams = {};
        for (const u of utterances) {
            const words = u.trim().toLowerCase().split(/\s+/);
            if (words[0]) {
                leadingWords[words[0]] = (leadingWords[words[0]] || 0) + 1;
            }
            if (words.length >= 2) {
                const bigram = words.slice(0, 2).join(" ");
                leadingBigrams[bigram] = (leadingBigrams[bigram] || 0) + 1;
            }
            if (words.length >= 3) {
                const trigram = words.slice(0, 3).join(" ");
                leadingTrigrams[trigram] = (leadingTrigrams[trigram] || 0) + 1;
            }
        }

        console.log("  Leading word distribution:");
        const sortedLeading = Object.entries(leadingWords)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);
        let cumPct = 0;
        for (const [word, count] of sortedLeading) {
            const pct = ((count / utterances.length) * 100).toFixed(1);
            cumPct += parseFloat(pct);
            console.log(
                `    ${word.padEnd(15)} ${String(count).padEnd(6)} ${pct.padStart(5)}%  (cum: ${cumPct.toFixed(1)}%)`,
            );
        }

        console.log("\n  Leading bigram distribution (top 15):");
        const sortedBigrams = Object.entries(leadingBigrams)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);
        for (const [bigram, count] of sortedBigrams) {
            const pct = ((count / utterances.length) * 100).toFixed(1);
            console.log(
                `    ${bigram.padEnd(25)} ${String(count).padEnd(6)} ${pct.padStart(5)}%`,
            );
        }

        console.log("\n  Leading trigram distribution (top 15):");
        const sortedTrigrams = Object.entries(leadingTrigrams)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15);
        for (const [trigram, count] of sortedTrigrams) {
            const pct = ((count / utterances.length) * 100).toFixed(1);
            console.log(
                `    ${trigram.padEnd(30)} ${String(count).padEnd(6)} ${pct.padStart(5)}%`,
            );
        }

        // 2. Sentence form classification
        const forms = {
            imperative: 0,
            desire: 0,
            question: 0,
            noun_phrase: 0,
            other: 0,
        };
        for (const u of utterances) {
            const lower = u.trim().toLowerCase();
            if (
                lower.startsWith("i want") ||
                lower.startsWith("i need") ||
                lower.startsWith("i'd like") ||
                lower.startsWith("i would like") ||
                lower.startsWith("i wanna")
            ) {
                forms.desire++;
            } else if (
                lower.startsWith("can ") ||
                lower.startsWith("could ") ||
                lower.startsWith("would ") ||
                lower.startsWith("will ") ||
                lower.startsWith("what") ||
                lower.startsWith("where") ||
                lower.startsWith("how") ||
                lower.startsWith("is ") ||
                lower.startsWith("are ")
            ) {
                forms.question++;
            } else if (
                /^[a-z]/.test(lower) &&
                !lower.startsWith("the ") &&
                !lower.startsWith("a ") &&
                !lower.startsWith("some ")
            ) {
                forms.imperative++;
            } else if (/^(the |a |some |an )/.test(lower)) {
                forms.noun_phrase++;
            } else {
                forms.other++;
            }
        }

        console.log("\n  Sentence form distribution:");
        for (const [form, count] of Object.entries(forms).sort(
            (a, b) => b[1] - a[1],
        )) {
            const pct = ((count / utterances.length) * 100).toFixed(1);
            console.log(
                `    ${form.padEnd(15)} ${String(count).padEnd(6)} ${pct}%`,
            );
        }

        // 3. Slot/entity usage frequency
        const entityCounts = {};
        const entityCombinations = {};
        for (const entry of entries) {
            const entitiesInEntry = new Set();
            for (const d of entry.data) {
                if (d.entity) {
                    entityCounts[d.entity] = (entityCounts[d.entity] || 0) + 1;
                    entitiesInEntry.add(d.entity);
                }
            }
            const combo = Array.from(entitiesInEntry).sort().join("+");
            if (combo) {
                entityCombinations[combo] =
                    (entityCombinations[combo] || 0) + 1;
            }
        }

        console.log("\n  Entity usage frequency:");
        for (const [entity, count] of Object.entries(entityCounts).sort(
            (a, b) => b[1] - a[1],
        )) {
            const pct = ((count / utterances.length) * 100).toFixed(1);
            console.log(
                `    ${entity.padEnd(20)} ${String(count).padEnd(6)} ${pct}%`,
            );
        }

        console.log("\n  Entity combination frequency (top 15):");
        for (const [combo, count] of Object.entries(entityCombinations)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)) {
            const pct = ((count / utterances.length) * 100).toFixed(1);
            console.log(
                `    ${combo.padEnd(45)} ${String(count).padEnd(6)} ${pct}%`,
            );
        }

        // 4. Structural template frequency
        console.log("\n  Most common structural templates (top 20):");
        const templateCounts = {};
        for (const t of templates) {
            // Normalize whitespace
            const norm = t.trim().replace(/\s+/g, " ");
            templateCounts[norm] = (templateCounts[norm] || 0) + 1;
        }
        const sortedTemplates = Object.entries(templateCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20);
        let templateCum = 0;
        for (const [template, count] of sortedTemplates) {
            const pct = ((count / utterances.length) * 100).toFixed(1);
            templateCum += parseFloat(pct);
            console.log(
                `    ${template.slice(0, 70).padEnd(72)} ${String(count).padEnd(5)} ${pct.padStart(5)}% (cum: ${templateCum.toFixed(1)}%)`,
            );
        }

        // 5. Unique templates count
        const uniqueTemplates = Object.keys(templateCounts).length;
        console.log(
            `\n  Unique structural templates: ${uniqueTemplates} (from ${utterances.length} utterances)`,
        );
        console.log(
            `  Template reuse ratio: ${(utterances.length / uniqueTemplates).toFixed(1)}x`,
        );

        // 6. Sample utterances
        console.log("\n  Sample utterances (first 10):");
        for (const u of utterances.slice(0, 10)) {
            console.log(`    "${u}"`);
        }

        console.log("\n");
    }
}

// ── MASSIVE Analysis ────────────────────────────────────────────────────

function analyzeMassive() {
    console.log("══════════════════════════════════════════════════════════");
    console.log("  MASSIVE (Amazon) — Music & Audio Intents");
    console.log("══════════════════════════════════════════════════════════\n");

    const filePath = path.resolve(__dirname, "1.0/data/en-US.jsonl");
    if (!fs.existsSync(filePath)) {
        console.log("  en-US.jsonl not found, skipping MASSIVE analysis");
        return;
    }

    const lines = fs.readFileSync(filePath, "utf-8").trim().split("\n");
    const allEntries = lines.map((l) => JSON.parse(l));

    console.log(`  Total entries: ${allEntries.length}`);

    // Find all unique intents/scenarios
    const intentCounts = {};
    for (const e of allEntries) {
        intentCounts[e.intent] = (intentCounts[e.intent] || 0) + 1;
    }

    // Show music/audio related intents
    const musicKeywords = [
        "music",
        "play",
        "audio",
        "song",
        "radio",
        "podcast",
        "volume",
    ];
    const musicIntents = Object.entries(intentCounts).filter(([intent]) =>
        musicKeywords.some((kw) => intent.toLowerCase().includes(kw)),
    );

    console.log("\n  Music/audio related intents:");
    for (const [intent, count] of musicIntents.sort((a, b) => b[1] - a[1])) {
        console.log(`    ${intent.padEnd(35)} ${count}`);
    }

    // Also show all scenarios
    const scenarioCounts = {};
    for (const e of allEntries) {
        scenarioCounts[e.scenario] = (scenarioCounts[e.scenario] || 0) + 1;
    }
    console.log("\n  All scenarios:");
    for (const [scenario, count] of Object.entries(scenarioCounts).sort(
        (a, b) => b[1] - a[1],
    )) {
        const hasMusic = ["music", "audio", "play"].some((kw) =>
            scenario.includes(kw),
        );
        console.log(
            `    ${scenario.padEnd(25)} ${String(count).padEnd(6)}${hasMusic ? " ← music/audio" : ""}`,
        );
    }

    // Analyze music-related entries in detail
    const musicRelatedIntents = new Set([
        "play_music",
        "music_likeness",
        "music_query",
        "music_settings",
        "music_dislikeness",
        "play_radio",
        "play_podcasts",
        "play_audiobook",
        "play_game",
        "audio_volume_up",
        "audio_volume_down",
        "audio_volume_mute",
        "audio_volume_other",
    ]);

    // Gather all entries that might be music-related by scenario or intent
    const musicEntries = allEntries.filter(
        (e) =>
            e.scenario === "music" ||
            e.scenario === "audio" ||
            e.scenario === "play" ||
            musicRelatedIntents.has(e.intent),
    );

    console.log(`\n  Music/audio entries: ${musicEntries.length}`);

    if (musicEntries.length === 0) {
        // Try broader matching
        const broadMusic = allEntries.filter(
            (e) =>
                e.intent.includes("play") ||
                e.intent.includes("music") ||
                e.intent.includes("audio") ||
                e.intent.includes("volume"),
        );
        console.log(`  Broad music match: ${broadMusic.length}`);
        if (broadMusic.length > 0) {
            musicEntries.push(...broadMusic);
        }
    }

    if (musicEntries.length === 0) return;

    // Group by intent and analyze
    const byIntent = {};
    for (const e of musicEntries) {
        if (!byIntent[e.intent]) byIntent[e.intent] = [];
        byIntent[e.intent].push(e);
    }

    for (const [intent, entries] of Object.entries(byIntent).sort(
        (a, b) => b[1].length - a[1].length,
    )) {
        if (entries.length < 10) continue;

        console.log(`\n  ── ${intent} (${entries.length} utterances) ──`);

        // Leading word distribution
        const leadingWords = {};
        for (const e of entries) {
            const first = e.utt.trim().toLowerCase().split(/\s+/)[0];
            if (first) leadingWords[first] = (leadingWords[first] || 0) + 1;
        }

        console.log("    Leading words:");
        let intentCum = 0;
        for (const [word, count] of Object.entries(leadingWords)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)) {
            const pct = ((count / entries.length) * 100).toFixed(1);
            intentCum += parseFloat(pct);
            console.log(
                `      ${word.padEnd(15)} ${String(count).padEnd(5)} ${pct.padStart(5)}%  (cum: ${intentCum.toFixed(1)}%)`,
            );
        }

        // Sentence form
        const forms = { imperative: 0, desire: 0, question: 0, other: 0 };
        for (const e of entries) {
            const l = e.utt.trim().toLowerCase();
            if (
                l.startsWith("i want") ||
                l.startsWith("i need") ||
                l.startsWith("i'd like") ||
                l.startsWith("i wanna")
            ) {
                forms.desire++;
            } else if (
                l.startsWith("can ") ||
                l.startsWith("could ") ||
                l.startsWith("what") ||
                l.startsWith("how") ||
                l.startsWith("is ") ||
                l.startsWith("are ")
            ) {
                forms.question++;
            } else if (/^[a-z]/.test(l)) {
                forms.imperative++;
            } else {
                forms.other++;
            }
        }
        console.log("    Sentence forms:");
        for (const [form, count] of Object.entries(forms).sort(
            (a, b) => b[1] - a[1],
        )) {
            if (count === 0) continue;
            console.log(
                `      ${form.padEnd(15)} ${String(count).padEnd(5)} ${((count / entries.length) * 100).toFixed(1)}%`,
            );
        }

        // Samples
        console.log("    Samples:");
        const shuffled = [...entries].sort(() => Math.random() - 0.5);
        for (const e of shuffled.slice(0, 8)) {
            console.log(`      "${e.utt}"`);
        }
    }
}

// ── Run ─────────────────────────────────────────────────────────────────

analyzeSnips();
analyzeMassive();
