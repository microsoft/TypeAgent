import { validateAction } from "../web-shopping/observer.mjs";

export function candidateSchema(snapshot) {
    return {
        type: "object",
        description:
            "Select one observed candidate ID matching the request, or no_fit if missing or ambiguous. Never return selectors, action arguments, or confidence scores.",
        properties: {
            choice: {
                type: "string",
                enum: [...snapshot.candidates.map(({ id }) => id), "no_fit"],
            },
        },
        required: ["choice"],
        additionalProperties: false,
    };
}

export async function generateTarget(snapshot, client, request) {
    if (!snapshot.candidates.length) return { candidate: undefined };
    const generation = await client.generate(
        request,
        snapshot.candidates.map(({ id, evidence }) => ({ id, evidence })),
        candidateSchema(snapshot),
    );
    const value = generation.value;
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length !== 1 ||
        !Object.hasOwn(value, "choice") ||
        typeof value.choice !== "string"
    )
        throw new Error("invalid_generated_choice");
    if (value.choice === "no_fit") return { candidate: undefined, generation };
    const candidate = snapshot.candidates.find(({ id }) => id === value.choice);
    if (!candidate) throw new Error("unknown_candidate");
    validateAction(candidate.action);
    return { candidate, generation };
}

export function fixtureGenerativeClient() {
    return {
        async generate(task, evidence) {
            const started = performance.now();
            const text =
                task === "Show only cordless tools"
                    ? "Cordless only"
                    : task === "Open Cordless Drill details"
                      ? "View Cordless Drill details"
                      : undefined;
            const matches = evidence.filter(
                (item) => text && item.evidence.text.trim() === text,
            );
            return {
                value: {
                    choice: matches.length === 1 ? matches[0].id : "no_fit",
                },
                requestedModel: "fixture-mock-not-a-model",
                latencyMs: performance.now() - started,
            };
        },
    };
}
