import {
    callJsonApiWithPool,
    createCopilotModelEndpointProvider,
    discoverEndpointPoolFromConfig,
    openai,
    setRuntimeConfig,
} from "@typeagent/aiclient";

export function createCopilotDecisionClient(
    config,
    { model = "gpt-6-luna-decisions", cliPath } = {},
    endpointProvider,
) {
    if (!model.trim()) throw new Error("Model name must not be empty.");
    setRuntimeConfig(config);
    const settings = openai.getChatModelSettings(
        `copilot:${config.copilot?.defaultModel ?? "gpt-5-mini"}`,
    );
    if (cliPath) settings.cliPath = cliPath;
    settings.timeout = 60_000;
    const provider =
        endpointProvider ?? createCopilotModelEndpointProvider(settings, model);
    return {
        endpoints: [
            { model, path: "/v1/decisions", authentication: "copilot" },
        ],
        async decide(state, questions) {
            let endpoint = await provider.getEndpoint();
            let response = await request(endpoint, state, questions);
            if (response.status === 401 || response.status === 403) {
                endpoint = await provider.getEndpoint(true);
                response = await request(endpoint, state, questions);
            }
            if (!response.ok) {
                const payload = await response.json().catch(() => undefined);
                const detail = payload?.error?.message ?? payload?.message;
                throw new Error(
                    `Copilot decisions request failed: HTTP ${response.status}${typeof detail === "string" ? `: ${detail}` : ""}`,
                );
            }
            return normalizeCopilotAnswers(await response.json(), questions);
        },
    };

    function request(endpoint, state, questions) {
        const url = new URL("/v1/decisions", endpoint.baseUrl);
        if (url.protocol !== "https:")
            throw new Error("Expected an HTTPS Copilot endpoint.");
        return fetch(url.href, {
            method: "POST",
            headers: {
                ...endpoint.headers,
                Accept: "application/json",
                "Content-Type": "application/json",
            },
            body: JSON.stringify(
                buildCopilotDecisionRequest(model, state, questions),
            ),
            signal: AbortSignal.timeout(settings.timeout),
        });
    }
}

export function buildCopilotDecisionRequest(model, state, questions) {
    return {
        model,
        input: typeof state === "string" ? state : JSON.stringify(state),
        questions: Object.entries(questions).map(([name, question]) => {
            const common = { name, instructions: question.instructions };
            switch (question.type) {
                case "noul":
                    return { ...common, type: "predicate" };
                case "choice":
                    return {
                        ...common,
                        type: "choice",
                        choices: Object.entries(question.criteria).map(
                            ([value, description]) => ({ value, description }),
                        ),
                    };
                case "score":
                    return {
                        ...common,
                        type: "score",
                        levels: question.criteria.map((label) => ({
                            label,
                            description: label,
                        })),
                    };
                default:
                    throw new Error(
                        `Unsupported question type '${question.type}'.`,
                    );
            }
        }),
    };
}

export function normalizeCopilotAnswers(payload, questions) {
    if (!Array.isArray(payload?.answers)) {
        throw new Error("Copilot decisions API returned no answers array.");
    }
    const names = payload.answers.map((answer) => answer?.name);
    if (
        names.length !== Object.keys(questions).length ||
        new Set(names).size !== names.length ||
        names.some(
            (name) =>
                typeof name !== "string" || !Object.hasOwn(questions, name),
        )
    ) {
        throw new Error(
            "Copilot decisions API returned missing, duplicate, or unknown answer names.",
        );
    }
    const answers = Object.fromEntries(
        payload.answers.map((answer) => {
            if (answer.type === "refusal")
                throw new Error(
                    `Decision API refused question '${answer.name}'.`,
                );
            if (answer.type === "predicate") {
                return [
                    answer.name,
                    { ...answer, type: "noul", noul: answer.probability },
                ];
            }
            if (!Array.isArray(answer.probabilities)) {
                throw new Error(
                    `Missing probability distribution for '${answer.name}'.`,
                );
            }
            const values = answer.probabilities.map((entry) => entry?.value);
            if (
                new Set(values).size !== values.length ||
                values.some((value) =>
                    answer.type === "score"
                        ? !Number.isSafeInteger(value)
                        : typeof value !== "string",
                )
            ) {
                throw new Error(
                    `Invalid probability distribution for '${answer.name}'.`,
                );
            }
            return [
                answer.name,
                {
                    ...answer,
                    probabilities: Object.fromEntries(
                        answer.probabilities.map((entry) => [
                            String(entry.value),
                            entry.probability,
                        ]),
                    ),
                },
            ];
        }),
    );
    return validateAnswers(
        { ...payload, answers, nativeAnswers: payload.answers },
        questions,
    );
}

export function createDecisionClient(config, configKey, model, region) {
    if (!config.azureOpenAI.deployments.has(configKey)) {
        throw new Error(`No deployment configured under '${configKey}'.`);
    }
    if (!model.trim()) throw new Error("Deployment name must not be empty.");
    const pool = discoverEndpointPoolFromConfig(
        config,
        "azure",
        openai.ModelType.Chat,
        configKey,
    );
    if (region) {
        pool.members = pool.members.filter(
            (member) => member.region === region,
        );
    }
    if (!pool.members.length) throw new Error("No endpoints match the region.");
    for (const member of pool.members) {
        const endpoint = new URL(member.settings.endpoint);
        if (
            endpoint.protocol !== "https:" ||
            endpoint.pathname !== "/providers/microsoft/v1/systemone"
        ) {
            throw new Error("Expected an HTTPS Microsoft systemone endpoint.");
        }
        member.settings.timeout = 60_000;
    }
    return {
        endpoints: pool.members.map((member) => ({
            region: member.region,
            endpoint: member.settings.endpoint,
            authentication: member.settings.tokenProvider
                ? "identity"
                : "api-key",
        })),
        async decide(state, questions) {
            const result = await callJsonApiWithPool(
                pool,
                async (member) => {
                    const settings = member.settings;
                    let headers;
                    if (settings.tokenProvider) {
                        const token =
                            await settings.tokenProvider.getAccessToken();
                        if (!token.success) return token;
                        headers = { Authorization: `Bearer ${token.data}` };
                    } else {
                        headers = { "api-key": settings.apiKey };
                    }
                    return {
                        success: true,
                        data: {
                            headers,
                            body: { model, state, questions },
                        },
                    };
                },
                { overallBudgetMs: 60_000 },
            );
            if (!result.success) throw new Error(result.message);
            return validateAnswers(result.data, questions);
        },
    };
}

export function validateAnswers(payload, questions) {
    if (!payload || typeof payload !== "object" || !payload.answers) {
        throw new Error("Decision API returned no answers object.");
    }
    for (const [name, question] of Object.entries(questions)) {
        const answer = payload.answers[name];
        if (!answer || answer.type !== question.type) {
            throw new Error(`Invalid answer type for '${name}'.`);
        }
        if (question.type === "choice") {
            if (
                typeof answer.choice !== "string" ||
                !Object.hasOwn(question.criteria, answer.choice)
            ) {
                throw new Error(`Unsupported choice for '${name}'.`);
            }
        } else {
            const value = question.type === "noul" ? answer.noul : answer.score;
            const maximum =
                question.type === "noul" ? 1 : question.criteria.length - 1;
            if (!Number.isFinite(value) || value < 0 || value > maximum) {
                throw new Error(`Invalid numerical answer for '${name}'.`);
            }
        }
        if (question.type !== "noul") {
            const keys =
                question.type === "choice"
                    ? Object.keys(question.criteria)
                    : question.criteria.map((_, index) => String(index));
            validateProbabilities(answer.probabilities, keys, name);
        }
    }
    return payload;
}

function validateProbabilities(probabilities, keys, name) {
    if (
        !probabilities ||
        typeof probabilities !== "object" ||
        Array.isArray(probabilities)
    ) {
        throw new Error(`Missing probability distribution for '${name}'.`);
    }
    const values = keys.map((key) => probabilities[key]);
    if (
        Object.keys(probabilities).length !== keys.length ||
        values.some(
            (value) => !Number.isFinite(value) || value < 0 || value > 1,
        ) ||
        Math.abs(values.reduce((total, value) => total + value, 0) - 1) > 0.01
    ) {
        throw new Error(`Invalid probability distribution for '${name}'.`);
    }
}

export function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
        ? sorted[middle]
        : (sorted[middle - 1] + sorted[middle]) / 2;
}
