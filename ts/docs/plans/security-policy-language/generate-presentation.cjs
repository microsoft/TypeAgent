// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

const path = require("node:path");
const pptxgen = require(
    path.join(
        process.env.TEMP,
        "typeagent-presentation-tools",
        "node_modules",
        "pptxgenjs",
    ),
);

const pptx = new pptxgen();
pptx.layout = "LAYOUT_WIDE";
pptx.author = "TypeAgent Security Architecture";
pptx.subject = "AI tool-policy intermediary recommendation";
pptx.title = "Policy that can explain itself";
pptx.company = "Microsoft";
pptx.lang = "en-US";
pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US",
};
pptx.defineSlideMaster({
    title: "CONTENT",
    background: { color: "F6F4EF" },
    objects: [
        {
            line: {
                x: 0.55,
                y: 7.12,
                w: 12.23,
                h: 0,
                line: { color: "D7D5CE", width: 0.8 },
            },
        },
        {
            text: {
                text: "AI TOOL POLICY  /  EXECUTIVE RECOMMENDATION",
                options: {
                    x: 0.62,
                    y: 7.2,
                    w: 5.6,
                    h: 0.16,
                    fontFace: "Aptos",
                    fontSize: 5.5,
                    bold: true,
                    color: "70736F",
                    charSpacing: 1.2,
                    margin: 0,
                },
            },
        },
    ],
    slideNumber: {
        x: 12.28,
        y: 7.18,
        w: 0.46,
        h: 0.18,
        fontFace: "Aptos",
        fontSize: 6,
        bold: true,
        color: "70736F",
        align: "right",
        margin: 0,
    },
});

const C = {
    ink: "172026",
    navy: "153342",
    cyan: "2FA7B8",
    cyanSoft: "DDEFF1",
    orange: "E46E3A",
    orangeSoft: "F7E4D8",
    green: "367C62",
    greenSoft: "DFECE5",
    yellow: "EABF4B",
    paper: "F6F4EF",
    white: "FFFFFF",
    muted: "687177",
    line: "D7D5CE",
    darkLine: "98A0A2",
    red: "B94A48",
    redSoft: "F2DEDC",
};

const S = pptx.ShapeType;

function addTitle(slide, kicker, title, subtitle) {
    slide.addText(kicker.toUpperCase(), {
        x: 0.62,
        y: 0.42,
        w: 2.8,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 7.5,
        bold: true,
        color: C.orange,
        charSpacing: 1.6,
        margin: 0,
    });
    slide.addText(title, {
        x: 0.62,
        y: 0.7,
        w: 11.9,
        h: 0.62,
        fontFace: "Aptos Display",
        fontSize: 25,
        bold: true,
        color: C.ink,
        breakLine: false,
        margin: 0,
        fit: "shrink",
    });
    if (subtitle) {
        slide.addText(subtitle, {
            x: 0.64,
            y: 1.37,
            w: 11.5,
            h: 0.38,
            fontFace: "Aptos",
            fontSize: 11.5,
            color: C.muted,
            margin: 0,
            fit: "shrink",
        });
    }
}

function addPill(slide, text, x, y, w, fill, color = C.ink) {
    slide.addShape(S.roundRect, {
        x,
        y,
        w,
        h: 0.34,
        rectRadius: 0.07,
        fill: { color: fill },
        line: { color: fill },
    });
    slide.addText(text, {
        x: x + 0.08,
        y: y + 0.07,
        w: w - 0.16,
        h: 0.16,
        fontFace: "Aptos",
        fontSize: 7.3,
        bold: true,
        color,
        align: "center",
        margin: 0,
        fit: "shrink",
    });
}

function addCard(slide, { x, y, w, h, number, title, body, accent = C.cyan }) {
    slide.addShape(S.rect, {
        x,
        y,
        w,
        h,
        fill: { color: C.white },
        line: { color: C.line, width: 0.8 },
        shadow: {
            type: "outer",
            color: "000000",
            opacity: 0.08,
            blur: 1.5,
            angle: 45,
            distance: 1,
        },
    });
    slide.addShape(S.rect, {
        x,
        y,
        w: 0.07,
        h,
        fill: { color: accent },
        line: { color: accent },
    });
    if (number) {
        slide.addText(number, {
            x: x + 0.24,
            y: y + 0.22,
            w: 0.42,
            h: 0.3,
            fontFace: "Aptos Display",
            fontSize: 12,
            bold: true,
            color: accent,
            margin: 0,
        });
    }
    slide.addText(title, {
        x: x + (number ? 0.72 : 0.25),
        y: y + 0.22,
        w: w - (number ? 0.98 : 0.5),
        h: 0.32,
        fontFace: "Aptos Display",
        fontSize: 12.5,
        bold: true,
        color: C.ink,
        margin: 0,
        fit: "shrink",
    });
    slide.addText(body, {
        x: x + 0.25,
        y: y + 0.7,
        w: w - 0.5,
        h: h - 0.92,
        fontFace: "Aptos",
        fontSize: 9.2,
        color: C.muted,
        breakLine: false,
        valign: "top",
        margin: 0,
        fit: "shrink",
        paraSpaceAfterPt: 5,
        bullet: false,
    });
}

function addArrow(slide, x1, y1, x2, y2, color = C.darkLine, width = 1.8) {
    const targetIsStart = x2 < x1 || (x2 === x1 && y2 < y1);
    slide.addShape(S.line, {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        w: Math.abs(x2 - x1),
        h: Math.abs(y2 - y1),
        flipV: (x2 - x1) * (y2 - y1) < 0,
        line: {
            color,
            width,
            beginArrowType: targetIsStart ? "triangle" : "none",
            endArrowType: targetIsStart ? "none" : "triangle",
        },
    });
}

function addQuote(slide, text, x, y, w, h, color = C.navy) {
    slide.addShape(S.rect, {
        x,
        y,
        w: 0.07,
        h,
        fill: { color: C.orange },
        line: { color: C.orange },
    });
    slide.addText(text, {
        x: x + 0.28,
        y,
        w: w - 0.28,
        h,
        fontFace: "Aptos Display",
        fontSize: 15,
        bold: true,
        italic: true,
        color,
        margin: 0,
        fit: "shrink",
        valign: "mid",
    });
}

function addNotes(slide, notes) {
    slide.addNotes(notes.join("\n\n"));
}

// 1. Recommendation
{
    const slide = pptx.addSlide();
    slide.background = { color: C.navy };
    slide.addShape(S.rect, {
        x: 9.7,
        y: 0,
        w: 3.63,
        h: 7.5,
        fill: { color: C.cyan },
        line: { color: C.cyan },
    });
    slide.addShape(S.arc, {
        x: 9.58,
        y: 0.8,
        w: 2.5,
        h: 2.5,
        adjustPoint: 0.28,
        rotate: 35,
        fill: { color: C.cyan, transparency: 100 },
        line: { color: C.white, transparency: 20, width: 3.5 },
    });
    slide.addText("EXECUTIVE RECOMMENDATION", {
        x: 0.68,
        y: 0.62,
        w: 3.2,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 7.5,
        bold: true,
        color: C.yellow,
        charSpacing: 1.7,
        margin: 0,
    });
    slide.addText("Policy that can\nexplain itself", {
        x: 0.68,
        y: 1.25,
        w: 8.2,
        h: 1.75,
        fontFace: "Aptos Display",
        fontSize: 36,
        bold: true,
        color: C.white,
        breakLine: false,
        margin: 0,
        fit: "shrink",
    });
    slide.addText(
        "Retain OPA/Rego as the AI tool-policy intermediary. Add a closed semantic registry, evidence trust, and deterministic proof layer.",
        {
            x: 0.72,
            y: 3.42,
            w: 7.8,
            h: 0.92,
            fontFace: "Aptos",
            fontSize: 18,
            color: "DDE7E9",
            margin: 0,
            fit: "shrink",
        },
    );
    addPill(slide, "PLAN OF RECORD", 0.72, 5.05, 1.48, C.orange, C.white);
    slide.addText("OPA service, sidecar, or governed bundles", {
        x: 2.42,
        y: 5.1,
        w: 4.9,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 9.5,
        color: C.white,
        margin: 0,
    });
    slide.addText("12 AUG 2026", {
        x: 10.25,
        y: 6.62,
        w: 2.5,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 7,
        bold: true,
        color: C.navy,
        charSpacing: 1.3,
        align: "right",
        margin: 0,
    });
    addNotes(slide, [
        "Lead with the decision. This is no longer a language bake-off.",
        "The recommendation is to keep Rego and productize the assurance layer that makes AI-authored policy reviewable and each authorization decision reproducible.",
    ]);
}

// 2. Product problem
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "The product problem",
        "AI can translate intent. Humans must verify it.",
        "One direction may be probabilistic; the return path must be deterministic.",
    );
    const stages = [
        {
            x: 0.72,
            title: "Intent",
            body: "Natural-language\nsecurity policy",
            fill: C.orangeSoft,
            accent: C.orange,
        },
        {
            x: 3.66,
            title: "Intermediary",
            body: "Formal policy\nOPA / Rego",
            fill: C.cyanSoft,
            accent: C.cyan,
        },
        {
            x: 6.6,
            title: "Review artifact",
            body: "Deterministic prose,\ntables + rule graph",
            fill: C.greenSoft,
            accent: C.green,
        },
        {
            x: 9.54,
            title: "Enforcement",
            body: "Service, sidecar\nor bundle",
            fill: "E7E9E8",
            accent: C.navy,
        },
    ];
    stages.forEach((stage, index) => {
        slide.addShape(S.rect, {
            x: stage.x,
            y: 2.3,
            w: 2.28,
            h: 2.12,
            fill: { color: stage.fill },
            line: { color: stage.accent, width: 1.2 },
        });
        slide.addText(String(index + 1).padStart(2, "0"), {
            x: stage.x + 0.2,
            y: 2.56,
            w: 0.45,
            h: 0.28,
            fontFace: "Aptos Display",
            fontSize: 12,
            bold: true,
            color: stage.accent,
            margin: 0,
        });
        slide.addText(stage.title, {
            x: stage.x + 0.2,
            y: 3.0,
            w: 1.9,
            h: 0.32,
            fontFace: "Aptos Display",
            fontSize: 14,
            bold: true,
            color: C.ink,
            margin: 0,
        });
        slide.addText(stage.body, {
            x: stage.x + 0.2,
            y: 3.46,
            w: 1.86,
            h: 0.56,
            fontFace: "Aptos",
            fontSize: 9.2,
            color: C.muted,
            margin: 0,
            fit: "shrink",
        });
        if (index < stages.length - 1)
            addArrow(
                slide,
                stage.x + 2.38,
                3.36,
                stage.x + 2.78,
                3.36,
                C.darkLine,
                2.2,
            );
    });
    addArrow(slide, 6.76, 4.93, 4.04, 4.93, C.orange, 2);
    slide.addText("writer approves or rejects", {
        x: 4.5,
        y: 5.04,
        w: 2.36,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 8.5,
        bold: true,
        color: C.orange,
        align: "center",
        margin: 0,
    });
    addQuote(
        slide,
        "The review artifact is the product's trust boundary.",
        2.15,
        5.73,
        9.1,
        0.62,
    );
    addNotes(slide, [
        "The AI-authored forward path is acceptable only because the reverse artifact is complete, deterministic, and inspectable.",
    ]);
}

// 3. Review contract
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "The review contract",
        "Five properties make the round trip trustworthy",
        "Concision is optimized only after completeness is satisfied.",
    );
    const items = [
        [
            "01",
            "Complete",
            "Every semantic leaf has registered prose and an executable predicate; defaults and failures appear.",
        ],
        [
            "02",
            "Concise",
            "Common concepts are factored without hiding decision-relevant detail.",
        ],
        [
            "03",
            "Deterministic",
            "Same normalized policy + renderer version = same artifact.",
        ],
        [
            "04",
            "Canonical",
            "Formatting, ordering and local names do not alter the review.",
        ],
        [
            "05",
            "Traceable",
            "Every sentence and row maps back to formal policy nodes.",
        ],
    ];
    items.forEach(([number, title, body], index) => {
        const y = 2.02 + index * 0.91;
        slide.addShape(S.ellipse, {
            x: 0.78,
            y,
            w: 0.55,
            h: 0.55,
            fill: { color: index === 0 ? C.orange : C.navy },
            line: { color: index === 0 ? C.orange : C.navy },
        });
        slide.addText(number, {
            x: 0.78,
            y: y + 0.18,
            w: 0.55,
            h: 0.12,
            fontFace: "Aptos",
            fontSize: 6.7,
            bold: true,
            color: C.white,
            align: "center",
            margin: 0,
        });
        slide.addText(title, {
            x: 1.58,
            y: y + 0.03,
            w: 2.0,
            h: 0.3,
            fontFace: "Aptos Display",
            fontSize: 13,
            bold: true,
            color: C.ink,
            margin: 0,
        });
        slide.addText(body, {
            x: 3.56,
            y: y + 0.03,
            w: 5.35,
            h: 0.46,
            fontFace: "Aptos",
            fontSize: 9.3,
            color: C.muted,
            margin: 0,
            fit: "shrink",
        });
        slide.addShape(S.line, {
            x: 1.56,
            y: y + 0.68,
            w: 7.45,
            h: 0,
            line: { color: C.line, width: 0.7 },
        });
    });
    slide.addShape(S.rect, {
        x: 9.48,
        y: 2.05,
        w: 2.95,
        h: 4.33,
        fill: { color: C.navy },
        line: { color: C.navy },
    });
    slide.addText("Acceptance test", {
        x: 9.78,
        y: 2.42,
        w: 2.35,
        h: 0.26,
        fontFace: "Aptos",
        fontSize: 8,
        bold: true,
        color: C.yellow,
        charSpacing: 1,
        margin: 0,
    });
    slide.addText(
        "Can the policy writer detect a seeded translation error before deployment?",
        {
            x: 9.78,
            y: 3.02,
            w: 2.25,
            h: 1.75,
            fontFace: "Aptos Display",
            fontSize: 19,
            bold: true,
            color: C.white,
            margin: 0,
            fit: "shrink",
        },
    );
    addPill(slide, "PRIMARY OUTCOME", 9.78, 5.45, 1.44, C.orange, C.white);
    slide.addText("detection rate × review time", {
        x: 9.78,
        y: 5.92,
        w: 2.22,
        h: 0.25,
        fontFace: "Aptos",
        fontSize: 8.5,
        color: "DDE7E9",
        margin: 0,
    });
    addNotes(slide, [
        "This is the common contract. It applies to Rego, TypeScript, and any specialized adjunct.",
    ]);
}

// 4. Central tradeoff
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "The central tradeoff",
        "Canonical review versus policy headroom",
        "Both approaches can be engineered well. Their structural boundaries remain different.",
    );
    slide.addShape(S.rect, {
        x: 0.7,
        y: 2.05,
        w: 5.72,
        h: 3.86,
        fill: { color: C.orangeSoft },
        line: { color: C.orange, width: 1.2 },
    });
    slide.addShape(S.rect, {
        x: 6.91,
        y: 2.05,
        w: 5.72,
        h: 3.86,
        fill: { color: C.cyanSoft },
        line: { color: C.cyan, width: 1.2 },
    });
    addPill(slide, "CHALLENGER", 1.02, 2.37, 1.2, C.orange, C.white);
    addPill(slide, "PLAN OF RECORD", 7.23, 2.37, 1.44, C.cyan, C.white);
    slide.addText("Closed TypeScript schema", {
        x: 1.02,
        y: 2.92,
        w: 4.8,
        h: 0.44,
        fontFace: "Aptos Display",
        fontSize: 20,
        bold: true,
        color: C.ink,
        margin: 0,
    });
    slide.addText("OPA / Rego", {
        x: 7.23,
        y: 2.92,
        w: 4.8,
        h: 0.44,
        fontFace: "Aptos Display",
        fontSize: 20,
        bold: true,
        color: C.ink,
        margin: 0,
    });
    slide.addText("Strongest inside a fixed ontology", {
        x: 1.03,
        y: 3.52,
        w: 4.4,
        h: 0.3,
        fontFace: "Aptos",
        fontSize: 11,
        bold: true,
        color: C.orange,
        margin: 0,
    });
    slide.addText("Strongest across an evolving ontology", {
        x: 7.24,
        y: 3.52,
        w: 4.65,
        h: 0.3,
        fontFace: "Aptos",
        fontSize: 11,
        bold: true,
        color: C.cyan,
        margin: 0,
    });
    slide.addText(
        [
            {
                text: "•  Total domain renderer by construction\n",
                options: { bullet: false },
            },
            {
                text: "•  Canonical organization and short prose\n",
                options: { bullet: false },
            },
            {
                text: "•  New concepts require a schema release",
                options: { bullet: false },
            },
        ],
        {
            x: 1.03,
            y: 4.12,
            w: 4.7,
            h: 1.13,
            fontFace: "Aptos",
            fontSize: 10,
            color: C.ink,
            breakLine: false,
            margin: 0,
            fit: "shrink",
            paraSpaceAfterPt: 8,
        },
    );
    slide.addText(
        [
            {
                text: "•  Native joins, quantifiers + derived facts\n",
                options: { bullet: false },
            },
            {
                text: "•  Rule graphs and derivation provenance\n",
                options: { bullet: false },
            },
            {
                text: "•  Canonical prose needs governance",
                options: { bullet: false },
            },
        ],
        {
            x: 7.24,
            y: 4.12,
            w: 4.75,
            h: 1.13,
            fontFace: "Aptos",
            fontSize: 10,
            color: C.ink,
            breakLine: false,
            margin: 0,
            fit: "shrink",
            paraSpaceAfterPt: 8,
        },
    );
    slide.addText("The implementation language is not the deciding boundary.", {
        x: 2.28,
        y: 6.32,
        w: 8.8,
        h: 0.31,
        fontFace: "Aptos Display",
        fontSize: 14,
        bold: true,
        color: C.navy,
        align: "center",
        margin: 0,
    });
    slide.addText("The authorable policy surface is.", {
        x: 3.82,
        y: 6.67,
        w: 5.72,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 9.5,
        color: C.muted,
        align: "center",
        margin: 0,
    });
    addNotes(slide, [
        "The TypeScript option means a finite JSON-like policy model, not arbitrary TypeScript predicates.",
    ]);
}

// 5. Why Rego wins
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "Why Rego wins",
        "The product decision is broader than language elegance",
        "Four advantages outweigh the residual canonicality gap.",
    );
    addCard(slide, {
        x: 0.7,
        y: 2.05,
        w: 2.9,
        h: 3.45,
        number: "01",
        title: "Policy frontier",
        body: "AI tool policy will require joins, quantification, reusable concepts and relationships that were not known when v1 shipped.",
        accent: C.cyan,
    });
    addCard(slide, {
        x: 3.72,
        y: 2.05,
        w: 2.9,
        h: 3.45,
        number: "02",
        title: "Provenance",
        body: "Declarative rules expose dependencies, facts and derivations. Stable IDs can link a decision to policy, evidence and snapshots.",
        accent: C.green,
    });
    addCard(slide, {
        x: 6.74,
        y: 2.05,
        w: 2.9,
        h: 3.45,
        number: "03",
        title: "Maturity",
        body: "OPA is CNCF Graduated with established service, sidecar, bundle, discovery and operating patterns.",
        accent: C.navy,
    });
    addCard(slide, {
        x: 9.76,
        y: 2.05,
        w: 2.86,
        h: 3.45,
        number: "04",
        title: "Economics",
        body: "It is already the plan of record. Switching adds migration, retraining, duplicate tooling, governance and lost ecosystem option value.",
        accent: C.orange,
    });
    slide.addShape(S.rect, {
        x: 1.58,
        y: 5.98,
        w: 10.18,
        h: 0.64,
        fill: { color: C.navy },
        line: { color: C.navy },
    });
    slide.addText(
        "A challenger must deliver a large user-visible assurance gain, not merely a cleaner implementation.",
        {
            x: 1.88,
            y: 6.17,
            w: 9.58,
            h: 0.24,
            fontFace: "Aptos Display",
            fontSize: 12,
            bold: true,
            color: C.white,
            align: "center",
            margin: 0,
            fit: "shrink",
        },
    );
    addNotes(slide, [
        "This is the decision slide. Rego wins on product readiness, expected coverage, and switching economics.",
    ]);
}

// 6. Preserve closure
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "Preserve the best of closure",
        "Close stable domains inside Rego",
        "A governed package can keep a finite authoring surface without creating another evaluator.",
    );
    const domains = [
        "FILE ACCESS",
        "CUSTOMER COMMS",
        "PROD DEPLOY",
        "DATABASE EXPORT",
    ];
    domains.forEach((domain, index) => {
        const x = 0.78 + index * 2.38;
        slide.addShape(S.rect, {
            x,
            y: 2.16,
            w: 2.06,
            h: 1.04,
            fill: { color: index % 2 ? C.greenSoft : C.cyanSoft },
            line: { color: index % 2 ? C.green : C.cyan, width: 1 },
        });
        slide.addText(domain, {
            x: x + 0.16,
            y: 2.54,
            w: 1.74,
            h: 0.2,
            fontFace: "Aptos",
            fontSize: 7.8,
            bold: true,
            color: C.ink,
            align: "center",
            charSpacing: 0.7,
            margin: 0,
            fit: "shrink",
        });
        addArrow(slide, x + 1.03, 3.28, 6.66, 4.15, C.darkLine, 1);
    });
    slide.addShape(S.rect, {
        x: 4.08,
        y: 3.88,
        w: 5.18,
        h: 1.35,
        fill: { color: C.navy },
        line: { color: C.navy },
    });
    slide.addText("VERSIONED CLOSED REGO PACKAGES", {
        x: 4.42,
        y: 4.18,
        w: 4.5,
        h: 0.26,
        fontFace: "Aptos",
        fontSize: 9,
        bold: true,
        color: C.yellow,
        align: "center",
        charSpacing: 1.1,
        margin: 0,
    });
    slide.addText(
        "registered leaf meaning  ·  executable predicate  ·  explicit composition",
        {
            x: 4.4,
            y: 4.62,
            w: 4.54,
            h: 0.23,
            fontFace: "Aptos",
            fontSize: 8.7,
            color: C.white,
            align: "center",
            margin: 0,
            fit: "shrink",
        },
    );
    addArrow(slide, 6.67, 5.25, 6.67, 5.78, C.orange, 2.4);
    slide.addShape(S.rect, {
        x: 3.4,
        y: 5.88,
        w: 6.55,
        h: 0.65,
        fill: { color: C.orangeSoft },
        line: { color: C.orange, width: 1 },
    });
    slide.addText(
        "Open Rego remains available for cross-domain and unforeseen relationships",
        {
            x: 3.68,
            y: 6.09,
            w: 5.98,
            h: 0.23,
            fontFace: "Aptos Display",
            fontSize: 10.5,
            bold: true,
            color: C.ink,
            align: "center",
            margin: 0,
            fit: "shrink",
        },
    );
    slide.addText(
        "Closure follows the published policy surface, not the .ts or .rego file extension.",
        {
            x: 10.43,
            y: 2.28,
            w: 2.02,
            h: 2.4,
            fontFace: "Aptos Display",
            fontSize: 14.5,
            bold: true,
            color: C.navy,
            margin: 0,
            fit: "shrink",
            valign: "mid",
        },
    );
    addNotes(slide, [
        "Closed Rego packages capture the TypeScript model's strongest property while preserving one production evaluator.",
    ]);
}

// 7. Fixed dimension example
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "Evidence 1",
        "Closed models render fixed dimensions better",
        "For known concepts, domain structure creates a shorter canonical review.",
    );
    slide.addShape(S.rect, {
        x: 0.72,
        y: 2.0,
        w: 3.08,
        h: 3.95,
        fill: { color: C.white },
        line: { color: C.line, width: 1 },
    });
    addPill(slide, "SOURCE POLICY", 0.98, 2.27, 1.22, C.navy, C.white);
    slide.addText(
        "Deny web search. Allow file reads under /work, except credentials. Deny all other tool calls.",
        {
            x: 0.98,
            y: 3.0,
            w: 2.56,
            h: 1.66,
            fontFace: "Aptos Display",
            fontSize: 16,
            bold: true,
            color: C.ink,
            margin: 0,
            fit: "shrink",
        },
    );
    addArrow(slide, 3.92, 3.98, 4.46, 3.98, C.darkLine, 2.2);
    slide.addShape(S.rect, {
        x: 4.6,
        y: 2.0,
        w: 3.58,
        h: 3.95,
        fill: { color: C.orangeSoft },
        line: { color: C.orange, width: 1.2 },
    });
    addPill(slide, "CLOSED SCHEMA", 4.87, 2.27, 1.34, C.orange, C.white);
    slide.addText(
        "default: deny\nread /work/**: allow\n**/credentials/**: deny\nprecedence: deny-overrides",
        {
            x: 4.88,
            y: 3.04,
            w: 2.95,
            h: 1.48,
            fontFace: "Cascadia Mono",
            fontSize: 11,
            color: C.ink,
            margin: 0,
            fit: "shrink",
            breakLine: false,
        },
    );
    addArrow(slide, 8.31, 3.98, 8.85, 3.98, C.darkLine, 2.2);
    slide.addShape(S.rect, {
        x: 8.99,
        y: 2.0,
        w: 3.62,
        h: 3.95,
        fill: { color: C.greenSoft },
        line: { color: C.green, width: 1.2 },
    });
    addPill(slide, "REVIEW ARTIFACT", 9.26, 2.27, 1.46, C.green, C.white);
    slide.addText(
        "By default, tool calls are denied. File reads are allowed under /work, except paths under credentials. Web search is denied. A deny rule overrides an allow rule.",
        {
            x: 9.26,
            y: 3.0,
            w: 3.05,
            h: 1.85,
            fontFace: "Aptos Display",
            fontSize: 13.4,
            bold: true,
            color: C.ink,
            margin: 0,
            fit: "shrink",
        },
    );
    slide.addText("ADVANTAGE  /  CLOSED MODEL", {
        x: 0.73,
        y: 6.38,
        w: 2.5,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 7,
        bold: true,
        color: C.orange,
        charSpacing: 1.2,
        margin: 0,
    });
    slide.addText("One predefined organization. One direct rendering.", {
        x: 3.32,
        y: 6.3,
        w: 6.9,
        h: 0.3,
        fontFace: "Aptos Display",
        fontSize: 13.5,
        bold: true,
        color: C.navy,
        margin: 0,
    });
    addNotes(slide, [
        "Concede the challenger's real strength. The recommendation is stronger when the tradeoff is represented fairly.",
    ]);
}

// 8. Relational example
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "Evidence 2",
        "Rego exposes a relational translation error",
        "The review artifact reveals that 'one authorized recipient' accidentally allows the entire email.",
    );
    slide.addShape(S.rect, {
        x: 0.72,
        y: 2.0,
        w: 3.4,
        h: 4.35,
        fill: { color: C.white },
        line: { color: C.line, width: 1 },
    });
    addPill(slide, "SOURCE POLICY", 0.98, 2.25, 1.22, C.navy, C.white);
    slide.addText(
        "Send customer email only when every recipient belongs to an assigned account, unless an active incident authorizes the account.",
        {
            x: 0.98,
            y: 2.92,
            w: 2.86,
            h: 2.03,
            fontFace: "Aptos Display",
            fontSize: 15.5,
            bold: true,
            color: C.ink,
            margin: 0,
            fit: "shrink",
        },
    );
    slide.addText("joins: recipients × customers × employees × incidents", {
        x: 0.98,
        y: 5.44,
        w: 2.82,
        h: 0.36,
        fontFace: "Aptos",
        fontSize: 8.2,
        color: C.muted,
        margin: 0,
        fit: "shrink",
    });
    addArrow(slide, 4.24, 4.13, 4.76, 4.13, C.darkLine, 2.2);
    slide.addShape(S.rect, {
        x: 4.9,
        y: 2.0,
        w: 3.32,
        h: 4.35,
        fill: { color: C.cyanSoft },
        line: { color: C.cyan, width: 1.2 },
    });
    addPill(slide, "REGO LOGIC", 5.16, 2.25, 1.12, C.cyan, C.white);
    slide.addText(
        "allow when\n  every recipient.account\n  is assigned to employee\n\nOR\n\nallow when\n  some recipient.account\n  is incident-authorized",
        {
            x: 5.18,
            y: 2.94,
            w: 2.7,
            h: 2.65,
            fontFace: "Cascadia Mono",
            fontSize: 9.7,
            color: C.ink,
            margin: 0,
            fit: "shrink",
            breakLine: false,
        },
    );
    addArrow(slide, 8.34, 4.13, 8.86, 4.13, C.darkLine, 2.2);
    slide.addShape(S.rect, {
        x: 9.0,
        y: 2.0,
        w: 3.62,
        h: 4.35,
        fill: { color: C.redSoft },
        line: { color: C.red, width: 1.2 },
    });
    addPill(slide, "DETERMINISTIC REVIEW", 9.25, 2.25, 1.77, C.red, C.white);
    slide.addText(
        "Email is allowed when either every recipient's account is assigned, or at least one recipient's account is incident-authorized.",
        {
            x: 9.25,
            y: 2.96,
            w: 3.02,
            h: 1.8,
            fontFace: "Aptos Display",
            fontSize: 13.8,
            bold: true,
            color: C.ink,
            margin: 0,
            fit: "shrink",
        },
    );
    slide.addShape(S.rect, {
        x: 9.25,
        y: 5.13,
        w: 3.02,
        h: 0.7,
        fill: { color: C.red },
        line: { color: C.red },
    });
    slide.addText("ERROR VISIBLE: “SOME” ≠ “EACH”", {
        x: 9.45,
        y: 5.36,
        w: 2.62,
        h: 0.18,
        fontFace: "Aptos",
        fontSize: 8,
        bold: true,
        color: C.white,
        align: "center",
        charSpacing: 0.5,
        margin: 0,
        fit: "shrink",
    });
    slide.addText("ADVANTAGE  /  REGO", {
        x: 0.73,
        y: 6.66,
        w: 2.15,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 7,
        bold: true,
        color: C.cyan,
        charSpacing: 1.2,
        margin: 0,
    });
    slide.addText(
        "Unforeseen relationships remain expressible and inspectable.",
        {
            x: 3.0,
            y: 6.58,
            w: 7.9,
            h: 0.3,
            fontFace: "Aptos Display",
            fontSize: 13.5,
            bold: true,
            color: C.navy,
            margin: 0,
        },
    );
    addNotes(slide, [
        "This is the core product example. The deterministic rendering does its job: it makes a wrong quantifier visible to the writer.",
    ]);
}

// 9. Four-plane authorization architecture
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "Target architecture",
        "Four planes, one reproducible decision",
        "Claims are typed evidence. They become policy facts only after validation and trust reduction.",
    );
    const planes = [
        {
            label: "MEANING + REVIEW",
            title: "Closed registry",
            body: "Stable leaf IDs\nregistered prose\ndeterministic dashboard",
            fill: C.orangeSoft,
            accent: C.orange,
        },
        {
            label: "EVIDENCE + TRUST",
            title: "Accepted facts",
            body: "signatures + issuers\ndelegation + validity\nrelationship snapshots",
            fill: C.cyanSoft,
            accent: C.cyan,
        },
        {
            label: "DECISION",
            title: "OPA / Rego",
            body: "closed policy tree\ntyped inputs\nallow · deny · indeterminate",
            fill: C.greenSoft,
            accent: C.green,
        },
        {
            label: "PROOF + AUDIT",
            title: "Typed proof DAG",
            body: "policy + evidence IDs\nsnapshot + evaluator versions\nindependent replay",
            fill: "E7E9E8",
            accent: C.navy,
        },
    ];
    planes.forEach((plane, index) => {
        const x = 0.7 + index * 3.13;
        slide.addShape(S.rect, {
            x,
            y: 2.18,
            w: 2.72,
            h: 3.38,
            fill: { color: plane.fill },
            line: { color: plane.accent, width: 1.1 },
        });
        slide.addText(plane.label, {
            x: x + 0.22,
            y: 2.51,
            w: 2.28,
            h: 0.2,
            fontFace: "Aptos",
            fontSize: 7.1,
            bold: true,
            color: plane.accent,
            charSpacing: 0.9,
            margin: 0,
            fit: "shrink",
        });
        slide.addText(plane.title, {
            x: x + 0.22,
            y: 3.05,
            w: 2.28,
            h: 0.38,
            fontFace: "Aptos Display",
            fontSize: 16,
            bold: true,
            color: C.ink,
            margin: 0,
            fit: "shrink",
        });
        slide.addText(plane.body, {
            x: x + 0.22,
            y: 3.78,
            w: 2.28,
            h: 1.18,
            fontFace: "Aptos",
            fontSize: 9.2,
            color: C.ink,
            margin: 0,
            fit: "shrink",
            breakLine: false,
        });
        if (index < planes.length - 1) {
            addArrow(slide, x + 2.78, 3.88, x + 3.03, 3.88, C.darkLine, 2);
        }
    });
    slide.addText(
        "A signed claim proves who made a statement. The policy proof shows why accepted facts authorize this request.",
        {
            x: 1.18,
            y: 6.12,
            w: 10.95,
            h: 0.46,
            fontFace: "Aptos Display",
            fontSize: 12,
            bold: true,
            color: C.navy,
            align: "center",
            margin: 0,
            fit: "shrink",
        },
    );
    addNotes(slide, [
        "Keep evidence validation distinct from policy evaluation. The proof DAG links both computations without conflating a certificate chain with an authorization derivation.",
        "For a confidential document, either a validated clearance fact or a snapshot-addressed sharing relation may satisfy the policy.",
    ]);
}

// 10. Risks and controls
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "Risks and controls",
        "Trust and proof boundaries must be explicit",
        "A credential is evidence, not self-interpreting authorization.",
    );
    const rows = [
        [
            "Private claim names imply meaning",
            "Typed claim registry with executable semantics + issuer authority",
            C.orange,
        ],
        [
            "Credentials or relations go stale",
            "Validity, revocation and relationship snapshot references",
            C.red,
        ],
        [
            "Provenance is mistaken for proof",
            "Pin policy, registry, evaluator and evidence for independent replay",
            C.cyan,
        ],
        [
            "Denial claims universal absence",
            "Declare credential-discovery and relationship-search boundaries",
            C.green,
        ],
        [
            "Delegation broadens authority",
            "Intersect scope, audience, validity and delegability at every hop",
            C.navy,
        ],
    ];
    slide.addText("RISK", {
        x: 0.86,
        y: 2.02,
        w: 4.3,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 7.5,
        bold: true,
        color: C.muted,
        charSpacing: 1.3,
        margin: 0,
    });
    slide.addText("PRODUCT CONTROL", {
        x: 6.07,
        y: 2.02,
        w: 5.75,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 7.5,
        bold: true,
        color: C.muted,
        charSpacing: 1.3,
        margin: 0,
    });
    rows.forEach(([risk, control, accent], index) => {
        const y = 2.45 + index * 0.86;
        slide.addShape(S.rect, {
            x: 0.75,
            y,
            w: 4.58,
            h: 0.65,
            fill: { color: C.white },
            line: { color: C.line, width: 0.7 },
        });
        slide.addShape(S.rect, {
            x: 0.75,
            y,
            w: 0.07,
            h: 0.65,
            fill: { color: accent },
            line: { color: accent },
        });
        slide.addText(risk, {
            x: 1.04,
            y: y + 0.2,
            w: 4.0,
            h: 0.21,
            fontFace: "Aptos Display",
            fontSize: 10.5,
            bold: true,
            color: C.ink,
            margin: 0,
            fit: "shrink",
        });
        addArrow(slide, 5.49, y + 0.325, 5.89, y + 0.325, accent, 1.8);
        slide.addShape(S.rect, {
            x: 6.05,
            y,
            w: 6.52,
            h: 0.65,
            fill: { color: index % 2 ? "ECEEEC" : C.greenSoft },
            line: { color: C.line, width: 0.7 },
        });
        slide.addText(control, {
            x: 6.34,
            y: y + 0.2,
            w: 5.94,
            h: 0.21,
            fontFace: "Aptos",
            fontSize: 9.5,
            bold: true,
            color: C.ink,
            margin: 0,
            fit: "shrink",
        });
    });
    addQuote(
        slide,
        "Denial is proven relative to declared authorities and snapshots, never by silence in one token.",
        2.06,
        6.66,
        9.2,
        0.34,
    );
    addNotes(slide, [
        "Unknown token fields do not enter a closed package. They are rejected or ignored as evidence according to the package contract.",
        "Delegated AI authority should attenuate monotonically: downstream agents may narrow rights but cannot manufacture grants.",
    ]);
}

// 11. Validation and gates
{
    const slide = pptx.addSlide("CONTENT");
    addTitle(
        slide,
        "Validate the recommendation",
        "Keep Rego unless the challenger clears every gate",
        "The experiment measures user-visible assurance, not implementation aesthetics.",
    );
    const gates = [
        [
            "Coverage",
            "Every critical held-out policy + ≥97% weighted corpus",
            C.cyan,
        ],
        [
            "Review gain",
            "+10 pts error detection OR −30% median review time",
            C.orange,
        ],
        [
            "No regression",
            "Correctness, failures, provenance, latency, relational policy",
            C.green,
        ],
        [
            "Economics",
            "Benefit exceeds migration + duplicate-platform cost",
            C.navy,
        ],
    ];
    gates.forEach(([title, body, accent], index) => {
        const y = 2.05 + index * 1.03;
        slide.addShape(S.ellipse, {
            x: 0.78,
            y: y + 0.05,
            w: 0.45,
            h: 0.45,
            fill: { color: accent },
            line: { color: accent },
        });
        slide.addText("✓", {
            x: 0.78,
            y: y + 0.16,
            w: 0.45,
            h: 0.18,
            fontFace: "Aptos",
            fontSize: 9,
            bold: true,
            color: C.white,
            align: "center",
            margin: 0,
        });
        slide.addText(title, {
            x: 1.48,
            y,
            w: 1.85,
            h: 0.3,
            fontFace: "Aptos Display",
            fontSize: 13.5,
            bold: true,
            color: C.ink,
            margin: 0,
        });
        slide.addText(body, {
            x: 3.36,
            y: y + 0.02,
            w: 4.73,
            h: 0.38,
            fontFace: "Aptos",
            fontSize: 9.5,
            color: C.muted,
            margin: 0,
            fit: "shrink",
        });
    });
    slide.addShape(S.rect, {
        x: 8.56,
        y: 2.05,
        w: 3.85,
        h: 4.08,
        fill: { color: C.navy },
        line: { color: C.navy },
    });
    slide.addText("CONTROLLED STUDY", {
        x: 8.92,
        y: 2.42,
        w: 3.13,
        h: 0.24,
        fontFace: "Aptos",
        fontSize: 8,
        bold: true,
        color: C.yellow,
        align: "center",
        charSpacing: 1.2,
        margin: 0,
    });
    slide.addText("30–50", {
        x: 9.3,
        y: 3.0,
        w: 2.4,
        h: 0.72,
        fontFace: "Aptos Display",
        fontSize: 34,
        bold: true,
        color: C.white,
        align: "center",
        margin: 0,
    });
    slide.addText("versioned policies", {
        x: 9.3,
        y: 3.75,
        w: 2.4,
        h: 0.28,
        fontFace: "Aptos",
        fontSize: 10,
        color: "DDE7E9",
        align: "center",
        margin: 0,
    });
    slide.addShape(S.line, {
        x: 9.18,
        y: 4.32,
        w: 2.76,
        h: 0,
        line: { color: "53717C", width: 1 },
    });
    slide.addText(
        "Seed one controlled error\nMeasure detection + time\nHold out relational cases",
        {
            x: 9.03,
            y: 4.65,
            w: 2.9,
            h: 1.05,
            fontFace: "Aptos",
            fontSize: 9.3,
            color: C.white,
            align: "center",
            margin: 0,
            fit: "shrink",
            breakLine: false,
        },
    );
    slide.addShape(S.rect, {
        x: 1.24,
        y: 6.42,
        w: 6.82,
        h: 0.44,
        fill: { color: C.orangeSoft },
        line: { color: C.orange, width: 0.8 },
    });
    slide.addText("Null decision: retain OPA/Rego.", {
        x: 1.48,
        y: 6.55,
        w: 6.34,
        h: 0.18,
        fontFace: "Aptos Display",
        fontSize: 10.5,
        bold: true,
        color: C.ink,
        align: "center",
        margin: 0,
    });
    addNotes(slide, [
        "Thresholds must be preregistered before the corpus is scored. Coverage above 97% is a floor, not itself a win.",
    ]);
}

// 12. Decision and next steps
{
    const slide = pptx.addSlide();
    slide.background = { color: C.navy };
    slide.addText("DECISION", {
        x: 0.7,
        y: 0.58,
        w: 1.4,
        h: 0.2,
        fontFace: "Aptos",
        fontSize: 7.5,
        bold: true,
        color: C.yellow,
        charSpacing: 1.7,
        margin: 0,
    });
    slide.addText("Fund the Rego production path", {
        x: 0.7,
        y: 1.1,
        w: 8.8,
        h: 0.7,
        fontFace: "Aptos Display",
        fontSize: 30,
        bold: true,
        color: C.white,
        margin: 0,
        fit: "shrink",
    });
    slide.addText(
        "Measure the TypeScript challenger. Switch only for a large demonstrated assurance gain.",
        {
            x: 0.73,
            y: 1.98,
            w: 8.6,
            h: 0.6,
            fontFace: "Aptos",
            fontSize: 15,
            color: "DDE7E9",
            margin: 0,
            fit: "shrink",
        },
    );
    const steps = [
        [
            "01",
            "Register",
            "Leaf meaning, executable predicates, claim schemas, trusted issuers",
        ],
        [
            "02",
            "Normalize",
            "Credentials and relationship snapshots into accepted typed facts",
        ],
        [
            "03",
            "Decide",
            "Closed Rego packages with total decisions + dashboard",
        ],
        [
            "04",
            "Prove",
            "Typed proof DAG, stable versions, denial boundaries, replay checker",
        ],
    ];
    steps.forEach(([number, title, body], index) => {
        const x = 0.72 + index * 3.08;
        slide.addShape(S.rect, {
            x,
            y: 3.28,
            w: 2.7,
            h: 2.35,
            fill: { color: index === 0 ? C.cyan : "234654" },
            line: { color: index === 0 ? C.cyan : "53717C", width: 1 },
        });
        slide.addText(number, {
            x: x + 0.22,
            y: 3.54,
            w: 0.5,
            h: 0.26,
            fontFace: "Aptos Display",
            fontSize: 12,
            bold: true,
            color: index === 0 ? C.navy : C.yellow,
            margin: 0,
        });
        slide.addText(title, {
            x: x + 0.22,
            y: 4.05,
            w: 2.2,
            h: 0.34,
            fontFace: "Aptos Display",
            fontSize: 15,
            bold: true,
            color: C.white,
            margin: 0,
        });
        slide.addText(body, {
            x: x + 0.22,
            y: 4.62,
            w: 2.17,
            h: 0.62,
            fontFace: "Aptos",
            fontSize: 8.6,
            color: index === 0 ? C.navy : "DDE7E9",
            margin: 0,
            fit: "shrink",
        });
    });
    slide.addShape(S.line, {
        x: 0.72,
        y: 6.45,
        w: 11.92,
        h: 0,
        line: { color: "53717C", width: 0.9 },
    });
    slide.addText("OPA / REGO REMAINS THE PLAN OF RECORD", {
        x: 0.72,
        y: 6.75,
        w: 5.0,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 7.5,
        bold: true,
        color: C.yellow,
        charSpacing: 1.3,
        margin: 0,
    });
    slide.addText("Security policy language recommendation  ·  12 Aug 2026", {
        x: 8.0,
        y: 6.75,
        w: 4.62,
        h: 0.22,
        fontFace: "Aptos",
        fontSize: 7.5,
        color: "AFC1C6",
        align: "right",
        margin: 0,
    });
    addNotes(slide, [
        "Close on the same decision as slide one. The funded production path now covers meaning, evidence trust, decision, and proof.",
        "The TypeScript challenger experiment remains useful, but it does not delay the Rego plan of record.",
    ]);
}

const output = path.join(__dirname, "OPA-Rego-Executive-Recommendation.pptx");
pptx.writeFile({ fileName: output });
