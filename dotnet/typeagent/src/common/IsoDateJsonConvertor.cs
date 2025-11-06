// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Globalization;

namespace TypeAgent.Common;

/// <summary>
/// Forces DateTimeOffset serialization/deserialization to a stable ISO 8601 (round‑trip) string ("o").
/// Example: 2025-11-05T14:23:17.1234567+00:00
/// </summary>
public class IsoDateJsonConverter : JsonConverter<DateTimeOffset>
{
    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        if (reader.TokenType == JsonTokenType.String)
        {
            string? s = reader.GetString();
            if (!string.IsNullOrEmpty(s))
            {
                if (DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var value))
                {
                    return value;
                }
            }
            throw new JsonException($"Invalid DateTimeOffset value: '{s}'.");
        }
        throw new JsonException("Invalid DateTimeOffset value");
    }

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options)
    {
        writer.WriteStringValue(value.ToISOString());
    }
}
