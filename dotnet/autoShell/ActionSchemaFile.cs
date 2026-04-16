// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

#nullable enable

using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace autoShell;

/// <summary>
/// Typed model for <c>.pas.json</c> schema files produced by the TypeAgent action schema compiler.
/// Only the fields needed for action-name extraction and validation are modeled.
/// </summary>
internal record ActionSchemaFile(
    [property: JsonPropertyName("version")] int Version,
    [property: JsonPropertyName("types")] Dictionary<string, ActionSchemaType>? Types
);

/// <summary>
/// A named type in the schema (e.g., <c>VolumeAction</c>, <c>DesktopActions</c>, <c>KnownPrograms</c>).
/// </summary>
internal record ActionSchemaType(
    [property: JsonPropertyName("name")] string? Name,
    [property: JsonPropertyName("type")] ActionSchemaTypeBody? Type
);

/// <summary>
/// The body of a type definition. The <see cref="Kind"/> discriminator determines which
/// fields are populated:
/// <list type="bullet">
///   <item><c>"object"</c> — <see cref="Fields"/> contains the property definitions.</item>
///   <item><c>"string-union"</c> — <see cref="TypeEnum"/> contains the allowed string values.</item>
///   <item><c>"type-union"</c> — references to other types (not modeled further).</item>
/// </list>
/// </summary>
internal record ActionSchemaTypeBody(
    [property: JsonPropertyName("type")] string? Kind,
    [property: JsonPropertyName("fields")] Dictionary<string, ActionSchemaField>? Fields,
    [property: JsonPropertyName("typeEnum")] string[]? TypeEnum
);

/// <summary>
/// A field within an object type (e.g., <c>actionName</c>, <c>parameters</c>).
/// </summary>
internal record ActionSchemaField(
    [property: JsonPropertyName("type")] ActionSchemaTypeBody? Type,
    [property: JsonPropertyName("optional")] bool Optional
);
