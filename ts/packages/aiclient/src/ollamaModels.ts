// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import {
    ImagePromptContent,
    MultimodalPromptContent,
    PromptSection,
    Result,
    success,
} from "typechat";
import { getEnvSetting } from "./common.js";
import { ChatModelWithStreaming, CompletionSettings } from "./models.js";
import {
    CommonApiSettings,
    CompletionUsageStats,
    EnvVars,
    ModelType,
} from "./openai.js";
import {
    callApi,
    callJsonApi,
    getJson,
    readResponseStream,
} from "./restClient.js";
import { TokenCounter } from "./tokenCounter.js";
import { OpenAIApiSettings } from "./openaiSettings.js";

export type OllamaApiSettings = CommonApiSettings & {
    provider: "ollama";
    modelType: ModelType;
    endpoint: string;
    modelName: string;
};

function getOllamaEndpointUrl(env: Record<string, string | undefined>) {
    return getEnvSetting(
        env,
        EnvVars.OLLAMA_ENDPOINT,
        undefined,
        "http://localhost:11434",
    );
}

type OllamaTagResult = {
    models: {
        name: string;
        modified_at: string;
        size: number;
        digest: string;
        details: {
            format: string;
            family: string;
            families: string[];
            parameter_size: string;
            quantization_level: string;
        };
    }[];
};

let modelNames: string[] | undefined;
export async function getOllamaModelNames(
    env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
    if (modelNames === undefined) {
        const url = getOllamaEndpointUrl(env);
        const result = await getJson({}, `${url}/api/tags`, undefined);
        if (result.success) {
            const tags = result.data as OllamaTagResult;
            modelNames = tags.models.map(
                (m) =>
                    `ollama:${
                        m.name.endsWith(":latest")
                            ? m.name.substring(0, m.name.length - 7)
                            : m.name
                    }`,
            );
        } else {
            modelNames = [];
        }
    }
    return modelNames;
}

export function ollamaApiSettingsFromEnv(
    modelType: ModelType,
    env: Record<string, string | undefined> = process.env,
    modelName: string = "phi3",
): OllamaApiSettings | OpenAIApiSettings {
    const useOAIEndpoint = env["OLLAMA_USE_OAI_ENDPOINT"] !== "0";
    if (modelType === ModelType.Image) {
        throw new Error("Image model not supported");
    }
    const url = getOllamaEndpointUrl(env);
    if (useOAIEndpoint) {
        return {
            provider: "openai",
            modelType,
            endpoint:
                modelType === ModelType.Chat
                    ? `${url}/v1/chat/completions`
                    : `${url}/v1/embeddings`,
            modelName,
            apiKey: "",
            supportsResponseFormat: true, // REVIEW: just assume it supports it. Ollama doesn't reject this option
        };
    } else {
        return {
            provider: "ollama",
            modelType,
            endpoint:
                modelType === ModelType.Chat
                    ? `${url}/api/chat`
                    : `${url}/api/embed`,
            modelName,
        };
    }
}

type OllamaChatCompletionUsage = {
    total_duration: number;
    load_duration: number;
    prompt_eval_count: number;
    prompt_eval_duration: number;
    eval_count: number;
    eval_duration: number;
};

type OllamaChatCompletion = {
    model: string;
    created_at: string;
    message: {
        role: "assistant";
        content: string;
    };
    done: true;
} & OllamaChatCompletionUsage;

type OllamaChatCompletionChunk =
    | {
          model: string;
          created_at: string;
          done: false;
          message: {
              role: "assistant";
              content: string;
          };
      }
    | ({
          model: string;
          created_at: string;
          done: true;
      } & OllamaChatCompletionUsage);

export function createOllamaChatModel(
    settings: OllamaApiSettings,
    completionSettings?: CompletionSettings,
    completionCallback?: (request: any, response: any) => void,
    tags?: string[],
) {
    completionSettings ??= {};
    completionSettings.n ??= 1;
    completionSettings.temperature ??= 0;

    const defaultParams = {
        model: settings.modelName,
    };
    const model: ChatModelWithStreaming = {
        completionSettings: completionSettings,
        completionCallback,
        complete,
        completeStream,
    };
    return model;

    function reportUsage(data: OllamaChatCompletionUsage) {
        try {
            // track token usage
            const usage: CompletionUsageStats = {
                completion_tokens: data.eval_count,
                prompt_tokens: data.prompt_eval_count,
                total_tokens: data.prompt_eval_count + data.eval_count,
            };

            TokenCounter.getInstance().add(usage, tags);
        } catch {}
    }

    async function complete(
        prompt: string | PromptSection[],
    ): Promise<Result<string>> {
        const messages =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;
        const isImageProptContent = (c: MultimodalPromptContent) =>
            (c as ImagePromptContent).type == "image_url";
        messages.map((ps) => {
            if (Array.isArray(ps.content)) {
                if (ps.content.some(isImageProptContent)) {
                    throw new Error("Image content not supported");
                }
            }
        });
        const params = {
            ...defaultParams,
            messages: messages,
            stream: false,
            options: completionSettings,
        };

        const result = await callJsonApi(
            {},
            settings.endpoint,
            params,
            settings.maxRetryAttempts,
            settings.retryPauseMs,
            undefined,
            settings.throttler,
        );
        if (!result.success) {
            return result;
        }

        const data = result.data as OllamaChatCompletion;
        if (model.completionCallback) {
            model.completionCallback(params, data);
        }

        reportUsage(data);

        return success(data.message.content as string);
    }

    async function completeStream(
        prompt: string | PromptSection[],
    ): Promise<Result<AsyncIterableIterator<string>>> {
        const messages: PromptSection[] =
            typeof prompt === "string"
                ? [{ role: "user", content: prompt }]
                : prompt;

        const isImageProptContent = (c: MultimodalPromptContent) =>
            (c as ImagePromptContent).type == "image_url";
        messages.map((ps) => {
            if (Array.isArray(ps.content)) {
                if (ps.content.some(isImageProptContent)) {
                    throw new Error("Image content not supported");
                }
            }
        });

        const params = {
            ...defaultParams,
            messages: messages,
            stream: true,
            ...completionSettings,
        };
        const result = await callApi(
            {},
            settings.endpoint,
            params,
            settings.maxRetryAttempts,
            settings.retryPauseMs,
        );
        if (!result.success) {
            return result;
        }
        return {
            success: true,
            data: (async function* () {
                const messageStream = readResponseStream(result.data);
                for await (const message of messageStream) {
                    const data: OllamaChatCompletionChunk = JSON.parse(message);
                    if (data.done) {
                        reportUsage(data);
                        break;
                    }
                    yield data.message.content;
                }
            })(),
        };
    }
}
