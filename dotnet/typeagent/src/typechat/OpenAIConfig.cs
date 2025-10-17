// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// OpenAI configuration
/// Can be initialized either from environment variables or from config files
/// </summary>
public class OpenAIConfig
{
    /// <summary>
    /// Names of environment variables
    /// </summary>
    public static class VariableNames
    {
        /// <summary>
        /// Api key to use with the OpenAI service
        /// </summary>
        public const string OPENAI_API_KEY = "OPENAI_API_KEY";

        /// <summary>
        /// The OpenAI endpoint, such as:
        /// https://api.openai.com/v1/chat/completions
        /// </summary>
        public const string OPENAI_ENDPOINT = "OPENAI_ENDPOINT";

        /// <summary>
        /// Optional: OpenAI organization
        /// </summary>
        public const string OPENAI_ORGANIZATION = "OPENAI_ORGANIZATION";

        /// <summary>
        /// Name of the language model to use
        /// </summary>
        public const string OPENAI_MODEL = "OPENAI_MODEL";

        /// <summary>
        /// Name of the embedding model to use
        /// </summary>
        public const string OPENAI_EMBEDDINGMODEL = "OPENAI_EMBEDDINGMODEL";

        /// <summary>
        /// Api key to use for Azure OpenAI service
        /// </summary>
        public const string AZURE_OPENAI_API_KEY = "AZURE_OPENAI_API_KEY";

        /// <summary>
        /// Endpoint to use for Azure OpenAI service.
        /// https://YOUR_RESOURCE_NAME.openai.azure.com
        /// </summary>
        public const string AZURE_OPENAI_ENDPOINT = "AZURE_OPENAI_ENDPOINT";
    }

    public OpenAIConfig() { }

    /// <summary>
    /// Use Azure OpenAI?
    /// </summary>
    public bool Azure { get; set; } = true;

    /// <summary>
    /// Api endpoint
    /// </summary>
    public string Endpoint { get; set; }

    /// <summary>
    /// Api key to use
    /// </summary>
    public string ApiKey { get; set; }

    /// <summary>
    /// Organization: only used by OpenAI service. 
    /// </summary>
    public string? Organization { get; set; }

    /// <summary>
    /// Model name
    /// </summary>
    public string? Model { get; set; }

    /// <summary>
    /// Api version
    /// </summary>
    public string ApiVersion { get; set; } = "2023-05-15";

    /// <summary>
    /// Http Settings
    /// </summary>
    public int TimeoutMs { get; set; } = 15 * 1000;

    public int MaxRetries { get; set; } = 3;

    public int MaxPauseMs { get; set; } = 1000; // 1000 milliseconds

    /// <summary>
    /// When provided, gets Api token from this provider
    /// </summary>
    public IApiTokenProvider ApiTokenProvider { get; set; }

    public bool HasTokenProvider
    {
        get { return this.ApiTokenProvider is not null; }
    }

    /// <summary>
    /// Validate the configuration
    /// </summary>
    /// <param name="configFileName">(optional) Config file the settings came from</param>
    public void Validate(string configFileName = default)
    {
        configFileName ??= string.Empty;

        Verify(Endpoint, nameof(Endpoint), configFileName);
        Verify(ApiKey, nameof(ApiKey), configFileName);
    }

    private void Verify(string value, string name, string fileName)
    {
        if (string.IsNullOrEmpty(value) || value == "?")
        {
            throw new ArgumentException($"OpenAIConfig: {name} is not initialized in {fileName}");
        }
    }

    /// <summary>
    /// Load configuration from environment variables
    /// </summary>
    /// <param name="isEmbedding">Is this an embedding model?</param>
    /// <returns></returns>
    public static OpenAIConfig FromEnvironment(bool isEmbedding = false)
    {
        OpenAIConfig config = new OpenAIConfig();
        config.ApiKey = Environment.GetEnvironmentVariable(VariableNames.AZURE_OPENAI_API_KEY);
        if (string.IsNullOrEmpty(config.ApiKey))
        {
            config.Azure = false;
            config.ApiKey = Environment.GetEnvironmentVariable(VariableNames.OPENAI_API_KEY);
            config.Endpoint = Environment.GetEnvironmentVariable(VariableNames.OPENAI_ENDPOINT);
            config.Organization = Environment.GetEnvironmentVariable(VariableNames.OPENAI_ORGANIZATION);
        }
        else
        {
            config.Endpoint = Environment.GetEnvironmentVariable(VariableNames.AZURE_OPENAI_ENDPOINT);
        }
        if (isEmbedding)
        {
            config.Model = Environment.GetEnvironmentVariable(VariableNames.OPENAI_EMBEDDINGMODEL);
        }
        else
        {
            config.Model = Environment.GetEnvironmentVariable(VariableNames.OPENAI_MODEL);
        }
        config.Validate();
        return config;
    }

    /// <summary>
    /// Load configuration from a json file. A trivial wrapper around the Json serializer
    /// </summary>
    /// <param name="jsonFilePath">json text</param>
    /// <returns>config object</returns>
    public static OpenAIConfig LoadFromJsonFile(string jsonFilePath)
    {
        string json = File.ReadAllText(jsonFilePath);
        if (string.IsNullOrEmpty(json))
        {
            throw new ArgumentException($"{jsonFilePath} is empty");
        }
        return Json.Parse<OpenAIConfig>(json);
    }
}
