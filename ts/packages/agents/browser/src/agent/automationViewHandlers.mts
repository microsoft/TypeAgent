// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    detailForWebFlow,
    parseAutomationId,
    summarizeWebFlow,
    type AutomationCatalog,
    type AutomationCatalogService,
    type AutomationDetail,
    type AutomationSummary,
    type AutomationValidationReport,
    type WebFlowLike,
} from "@typeagent/agent-flows/catalog";

// WebFlows are owned by this agent; everything else comes from the catalog
// service the agent server supplies.
export interface WebFlowSource {
    getAllWebFlows(params: {}): Promise<unknown>;
    deleteWebFlow(params: { name: string }): Promise<unknown>;
}

export interface AutomationViewFunctions {
    listAutomations(params: {}): Promise<AutomationCatalog>;
    getAutomation(params: { id: string }): Promise<AutomationDetail>;
    validateAutomation(params: {
        id: string;
    }): Promise<AutomationValidationReport>;
    approveAutomation(params: { id: string }): Promise<AutomationSummary>;
    disableAutomation(params: { id: string }): Promise<AutomationSummary>;
    deleteAutomation(params: { id: string }): Promise<{ success: true }>;
}

const CATALOG_UNAVAILABLE = "The automation catalog service is not available.";

async function loadWebFlows(source: WebFlowSource): Promise<WebFlowLike[]> {
    const response = (await source.getAllWebFlows({})) as
        | { actions?: WebFlowLike[]; success?: boolean; error?: string }
        | WebFlowLike[]
        | null
        | undefined;
    if (Array.isArray(response)) return response;
    if (response?.success === false) {
        throw new Error(response.error || "Failed to load web macros");
    }
    return response?.actions ?? [];
}

export function createAutomationViewFunctions(
    webFlows: WebFlowSource,
    getCatalog: () => AutomationCatalogService | undefined,
): AutomationViewFunctions {
    function catalog(): AutomationCatalogService {
        const service = getCatalog();
        if (!service) throw new Error(CATALOG_UNAVAILABLE);
        return service;
    }

    function kindOf(id: string) {
        const parsed = parseAutomationId(id);
        if (!parsed) throw new Error(`Unknown automation id: ${id}`);
        return parsed;
    }

    async function findWebFlow(name: string): Promise<WebFlowLike> {
        const flow = (await loadWebFlows(webFlows)).find(
            (f) => f.name === name,
        );
        if (!flow) throw new Error(`Automation not found: webflow:${name}`);
        return flow;
    }

    return {
        async listAutomations() {
            const service = getCatalog();
            const [webResult, others] = await Promise.all([
                loadWebFlows(webFlows).then(
                    (flows) => ({ flows, error: undefined }),
                    (error: unknown) => ({
                        flows: [] as WebFlowLike[],
                        error:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    }),
                ),
                service
                    ? service.list()
                    : Promise.resolve<AutomationCatalog>({
                          items: [],
                          providers: (
                              ["powershell", "taskflow", "toolMacro"] as const
                          ).map((kind) => ({
                              kind,
                              available: false,
                              reason: CATALOG_UNAVAILABLE,
                          })),
                      }),
            ]);
            return {
                items: [
                    ...webResult.flows.map(summarizeWebFlow),
                    ...others.items,
                ],
                providers: [
                    {
                        kind: "webflow",
                        available: webResult.error === undefined,
                        ...(webResult.error === undefined
                            ? {}
                            : { reason: webResult.error }),
                    },
                    ...others.providers,
                ],
            };
        },

        async getAutomation({ id }) {
            const parsed = kindOf(id);
            if (parsed.kind === "webflow") {
                return detailForWebFlow(await findWebFlow(parsed.nativeId));
            }
            return catalog().get(id);
        },

        validateAutomation: async ({ id }) => catalog().validate(id),
        approveAutomation: async ({ id }) => catalog().approve(id),
        disableAutomation: async ({ id }) => catalog().disable(id),

        async deleteAutomation({ id }) {
            const parsed = kindOf(id);
            if (parsed.kind === "webflow") {
                const result = (await webFlows.deleteWebFlow({
                    name: parsed.nativeId,
                })) as { success?: boolean } | undefined;
                if (result?.success === false) {
                    throw new Error(`Automation not found: ${id}`);
                }
            } else {
                await catalog().remove(id);
            }
            return { success: true };
        },
    };
}
