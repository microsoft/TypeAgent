import { decisionObserve, observeHost } from "../web-shopping/observer.mjs";
import { generateTarget } from "../web-shopping-generative/selection.mjs";

export async function selectHybrid(
    page,
    snapshot,
    clients,
    request,
    metrics = {},
) {
    const started = performance.now();
    metrics.path = "decision-selection";
    let selection;
    try {
        selection = await decisionObserve(snapshot, clients.decision, request);
    } catch (error) {
        if (
            [
                "invalid_fit",
                "unknown_candidate",
                "invalid_host_action",
                "invalid_click_arguments",
                "invalid_action_arguments",
                "disallowed_key",
            ].includes(error.message)
        )
            throw error;
        throw new Error("decision_provider_failed");
    } finally {
        metrics.decisionLatencyMs = performance.now() - started;
    }
    if (selection?.candidate) {
        metrics.path = "decision-fast-path";
        return { snapshot, candidate: selection.candidate };
    }
    metrics.path = "generative-fallback";
    const freshSnapshot = await observeHost(page);
    const generationStart = performance.now();
    try {
        const generated = await generateTarget(
            freshSnapshot,
            clients.generative,
            request,
        );
        metrics.requestedChatModel = generated.generation?.requestedModel;
        metrics.usage = generated.generation?.usage;
        return { snapshot: freshSnapshot, candidate: generated.candidate };
    } finally {
        metrics.generativeLatencyMs = performance.now() - generationStart;
    }
}
