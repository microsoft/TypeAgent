// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class ModelApiSettings : ApiSettings
{
    public enum ApiProvider
    {
        Azure,
        OpenAI
    }

    public ModelApiSettings(ApiProvider provider, ModelType type, string endpoint, string apiKey)
        : base(endpoint, apiKey)
    {
        Provider = provider;
        Type = type;
        ModelName = string.Empty;
    }

    public string ModelName { get; set; }

    public ApiProvider Provider { get; }

    public ModelType Type { get; }

    public static ModelApiSettings FromEnv(ModelType modelType, string? endpointName = null)
    {
        return EnvVars.HasKey(EnvVars.OPENAI_API_KEY)
            ? OpenAIModelApiSettings.FromEnv(modelType, endpointName)
            : AzureModelApiSettings.FromEnv(modelType, endpointName);
    }
}
