// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class EnvVars
{
    public const string AZURE_OPENAI_API_KEY_EMBEDDING = "AZURE_OPENAI_API_KEY_EMBEDDING";
    public const string AZURE_OPENAI_ENDPOINT = "AZURE_OPENAI_ENDPOINT";
    public const string AZURE_OPENAI_ENDPOINT_EMBEDDING = "AZURE_OPENAI_ENDPOINT_EMBEDDING";

    public const string OPENAI_API_KEY = "OPENAI_API_KEY";
    public const string OPENAI_ENDPOINT = "OPENAI_ENDPOINT";
    public const string OPENAI_ENDPOINT_EMBEDDING = "OPENAI_ENDPOINT_EMBEDDING";
    public const string OPENAI_ORGANIZATION = "OPENAI_ORGANIZATION";
    public const string OPENAI_MODEL = "OPENAI_MODEL";
    public const string OPENAI_MODEL_EMBEDDING = "OPENAI_MODEL_EMBEDDING";

    public static string Get(string key, string? keySuffix = null, string? defaultValue = null, bool requireSuffix = false)
    {
        string envKey = !string.IsNullOrEmpty(keySuffix) ? key + "_" + keySuffix : key;
        var value = Environment.GetEnvironmentVariable(envKey) ?? defaultValue;
        if (string.IsNullOrEmpty(value) && !string.IsNullOrEmpty(keySuffix))
        {
            if (!requireSuffix)
            {
                envKey = key;
                // Fallback to key without the suffix
                value = Environment.GetEnvironmentVariable(envKey);
            }
        }
        return string.IsNullOrEmpty(value)
            ? throw new AIClientException(AIClientException.ErrorCode.MissingApiSetting, $"Missing ApiSetting: {envKey}")
            : value;
    }

    public static bool HasKey(string key)
    {
        try
        {
            var value = Get(key);
            return !string.IsNullOrEmpty(value);
        }
        catch
        {
        }
        return false;
    }
}
