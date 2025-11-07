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

    public ModelApiSettings(ModelApiSettings src)
        : base(src.Endpoint, src.ApiKey)
    {
        Provider = src.Provider;
        Type = src.Type;
        ModelName = src.ModelName;
    }

    public string ModelName { get; set; }

    public ApiProvider Provider { get; }

    public ModelType Type { get; }

    public ModelApiSettings Clone() => new ModelApiSettings(this);

    public static ModelApiSettings FromEnv(ModelType modelType, string? endpointName = null)
    {
        return EnvVars.HasKey(EnvVars.OPENAI_API_KEY)
            ? OpenAIModelApiSettings.FromEnv(modelType, endpointName)
            : AzureModelApiSettings.FromEnv(modelType, endpointName);
    }
}
