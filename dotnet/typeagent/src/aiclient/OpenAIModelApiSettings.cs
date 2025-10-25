// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class OpenAIModelApiSettings : ModelApiSettings
{
    public OpenAIModelApiSettings(
        ModelType type,
        string endpoint,
        string apiKey,
        string modelName,
        string? organization
    )
        : base(ApiProvider.OpenAI, type, endpoint, apiKey)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(modelName, nameof(modelName));

        ModelName = modelName;
        Organization = organization;
    }

    public string? Organization { get; }

    public override void Configure(HttpClient client)
    {
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", ApiKey);
        if (!string.IsNullOrEmpty(Organization))
        {
            client.DefaultRequestHeaders.Add("OpenAI-Organization", Organization);
        }
    }

    public static new OpenAIModelApiSettings FromEnv(ModelType modelType, string? endpointName = null)
    {
        OpenAIModelApiSettings? settings = null;
        switch (modelType)
        {
            default:
                break;

            case ModelType.Embedding:
                settings = EmbeddingSettingsFromEnv(endpointName);
                break;
        }
        ;

        return settings is not null
            ? settings
            : throw new NotImplementedException();
    }

    public static OpenAIModelApiSettings EmbeddingSettingsFromEnv(string? endpointName = null)
    {
        // TODO: Load retry settings
        return new OpenAIModelApiSettings(
            ModelType.Embedding,
            EnvVars.Get(
                EnvVars.OPENAI_ENDPOINT_EMBEDDING,
                endpointName
            ),
            EnvVars.Get(
                EnvVars.OPENAI_API_KEY,
                endpointName
            ),
            EnvVars.Get(
                EnvVars.OPENAI_MODEL_EMBEDDING,
                endpointName
            ),
            EnvVars.Get(
                EnvVars.OPENAI_ORGANIZATION,
                endpointName
            )
        );
    }

}
