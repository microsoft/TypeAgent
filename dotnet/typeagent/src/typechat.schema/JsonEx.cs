// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Schema;

internal static class JsonEx
{
    public static string? GetStringProperty(this ref Utf8JsonReader reader, string expectedPropertyName)
    {
        string? propertyName = null;
        if (reader.TokenType == JsonTokenType.PropertyName)
        {
            propertyName = reader.GetString();
        }
        if (propertyName is null || propertyName != expectedPropertyName)
        {
            throw new JsonException($"Expected property {expectedPropertyName}");
        }
        string? value = reader.GetString();
        return value;
    }
}
