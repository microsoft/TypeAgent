// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class EnvVars
{
    public const string AZURE_OPENAI_API_KEY_EMBEDDING = "AZURE_OPENAI_API_KEY_EMBEDDING";
    public const string AZURE_OPENAI_ENDPOINT_EMBEDDING = "AZURE_OPENAI_ENDPOINT_EMBEDDING";

    public static string Get(string key, string? keySuffix, string? defaultValue = null, bool requireSuffix = false)
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

}
