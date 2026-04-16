// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;

namespace autoShell;

/// <summary>
/// Extension methods for <see cref="JsonElement"/> to simplify reading optional properties.
/// Provides null-safe accessors similar to Newtonsoft's <c>Value&lt;T&gt;</c> method.
/// </summary>
internal static class JsonElementExtensions
{
    /// <summary>
    /// Returns the string value of <paramref name="propertyName"/>,
    /// or <paramref name="defaultValue"/> if the property is missing or not a string.
    /// </summary>
    public static string GetStringOrDefault(this JsonElement element, string propertyName, string defaultValue = null)
    {
        return element.TryGetProperty(propertyName, out JsonElement value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : defaultValue;
    }

    /// <summary>
    /// Returns the integer value of <paramref name="propertyName"/>,
    /// or <paramref name="defaultValue"/> if the property is missing or not a number.
    /// </summary>
    public static int GetIntOrDefault(this JsonElement element, string propertyName, int defaultValue = 0)
    {
        return element.TryGetProperty(propertyName, out JsonElement value) && value.ValueKind == JsonValueKind.Number
            ? value.GetInt32()
            : defaultValue;
    }

    /// <summary>
    /// Returns the boolean value of <paramref name="propertyName"/>,
    /// or <paramref name="defaultValue"/> if the property is missing or not a boolean.
    /// </summary>
    public static bool GetBoolOrDefault(this JsonElement element, string propertyName, bool defaultValue = false)
    {
        if (element.TryGetProperty(propertyName, out JsonElement value))
        {
            if (value.ValueKind == JsonValueKind.True)
            {
                return true;
            }

            if (value.ValueKind == JsonValueKind.False)
            {
                return false;
            }
        }
        return defaultValue;
    }

    /// <summary>
    /// Returns the integer value of <paramref name="propertyName"/>,
    /// or <c>null</c> if the property is missing or not a number.
    /// </summary>
    public static int? GetNullableInt(this JsonElement element, string propertyName)
    {
        return element.TryGetProperty(propertyName, out JsonElement value) && value.ValueKind == JsonValueKind.Number
            ? value.GetInt32()
            : null;
    }

    /// <summary>
    /// Returns the boolean value of <paramref name="propertyName"/>,
    /// or <c>null</c> if the property is missing or not a boolean.
    /// </summary>
    public static bool? GetNullableBool(this JsonElement element, string propertyName)
    {
        if (element.TryGetProperty(propertyName, out JsonElement value))
        {
            if (value.ValueKind == JsonValueKind.True)
            {
                return true;
            }

            if (value.ValueKind == JsonValueKind.False)
            {
                return false;
            }
        }
        return null;
    }
}
