// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace TypeAgent.AIClient;

public class EnvVars
{
    public const string AZURE_OPENAI_ENDPOINT = "AZURE_OPENAI_ENDPOINT";
    public const string AZURE_OPENAI_API_KEY = "AZURE_OPENAI_API_KEY";
    public const string AZURE_OPENAI_MAX_TIMEOUT = "AZURE_OPENAI_MAX_TIMEOUT";
    public const string AZURE_OPENAI_MAX_RETRYATTEMPTS = "AZURE_OPENAI_MAX_RETRYATTEMPTS";

    public const string AZURE_OPENAI_ENDPOINT_EMBEDDING = "AZURE_OPENAI_ENDPOINT_EMBEDDING";
    public const string AZURE_OPENAI_API_KEY_EMBEDDING = "AZURE_OPENAI_API_KEY_EMBEDDING";

    public const string OPENAI_API_KEY = "OPENAI_API_KEY";
    public const string OPENAI_ENDPOINT = "OPENAI_ENDPOINT";
    public const string OPENAI_ENDPOINT_EMBEDDING = "OPENAI_ENDPOINT_EMBEDDING";
    public const string OPENAI_ORGANIZATION = "OPENAI_ORGANIZATION";
    public const string OPENAI_MODEL = "OPENAI_MODEL";
    public const string OPENAI_MODEL_EMBEDDING = "OPENAI_MODEL_EMBEDDING";

    public static string Get(string key, string? keySuffix = null, string? defaultValue = null, bool requireSuffix = false)
    {
        string envKey = ToVarName(key, keySuffix);
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

    public static int GetInt(string key, string? keySuffix = null, int? defaultValue = null)
    {
        var numString = Get(key, keySuffix, defaultValue?.ToString());
        if (string.IsNullOrEmpty(numString) && defaultValue is not null)
        {
            return defaultValue.Value;
        }
        if (int.TryParse(numString, out int value) && value > 0)
        {
            return value;
        }
        throw new AIClientException(AIClientException.ErrorCode.InvalidApiSetting, $"Invalid ApiSetting: {ToVarName(key, keySuffix)}");
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

    public static string ToVarName(string key, string? keySuffix = null)
    {
        return !string.IsNullOrEmpty(keySuffix) ? key + "_" + keySuffix : key;
    }
}
