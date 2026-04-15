// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using autoShell.Logging;

namespace autoShell;

/// <summary>
/// Reads <c>.pas.json</c> schema files produced by the TypeAgent action schema compiler
/// and extracts action names. Used at startup to cross-validate that every schema-defined
/// action has a registered C# handler and vice versa.
/// </summary>
internal class SchemaValidator
{
    /// <summary>
    /// Default path from the autoShell binary to the desktop agent's dist folder.
    /// </summary>
    internal static readonly string DefaultSchemaRelativePath =
        Path.Combine("..", "..", "..", "..", "ts", "packages", "agents", "desktop", "dist");

    private readonly ILogger _logger;

    public SchemaValidator(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Extracts action names from all <c>.pas.json</c> files in the given directory.
    /// Each action type in the schema has an <c>actionName</c> field whose
    /// <c>typeEnum</c> array contains the action name as its single element.
    /// </summary>
    /// <returns>A set of action names found across all schema files, or an empty set if the directory is missing.</returns>
    public HashSet<string> LoadActionNames(string schemaDirectory)
    {
        var actionNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!Directory.Exists(schemaDirectory))
        {
            _logger.Info($"Schema directory not found: {schemaDirectory}. Skipping validation.");
            return actionNames;
        }

        var schemaFiles = Directory.GetFiles(schemaDirectory, "*.pas.json");
        if (schemaFiles.Length == 0)
        {
            _logger.Info($"No .pas.json files found in {schemaDirectory}. Skipping validation.");
            return actionNames;
        }

        foreach (var filePath in schemaFiles)
        {
            try
            {
                var names = ExtractActionNames(File.ReadAllText(filePath));
                actionNames.UnionWith(names);
            }
            catch (Exception ex)
            {
                _logger.Warning($"Failed to parse schema file {Path.GetFileName(filePath)}: {ex.Message}");
            }
        }

        return actionNames;
    }

    /// <summary>
    /// Extracts action names from a single <c>.pas.json</c> JSON string.
    /// Deserializes into <see cref="ActionSchemaFile"/> and finds types whose
    /// <c>actionName</c> field has a <c>string-union</c> type with a <c>typeEnum</c> array.
    /// </summary>
    internal static HashSet<string> ExtractActionNames(string json)
    {
        var actionNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var schema = JsonSerializer.Deserialize<ActionSchemaFile>(json);

        if (schema?.Types == null)
        {
            return actionNames;
        }

        foreach (var schemaType in schema.Types.Values)
        {
            // Only object types can have an actionName field
            if (schemaType.Type?.Kind != "object" || schemaType.Type.Fields == null)
            {
                continue;
            }

            if (!schemaType.Type.Fields.TryGetValue("actionName", out var actionNameField))
            {
                continue;
            }

            var typeEnum = actionNameField.Type?.TypeEnum;
            if (typeEnum == null)
            {
                continue;
            }

            foreach (var name in typeEnum)
            {
                actionNames.Add(name);
            }
        }

        return actionNames;
    }

    /// <summary>
    /// Compares schema-defined action names against registered handler actions
    /// and logs warnings for any mismatches.
    /// </summary>
    /// <param name="schemaActions">Action names from .pas.json files.</param>
    /// <param name="registeredActions">Action names from handler SupportedActions.</param>
    public void ValidateWiring(HashSet<string> schemaActions, IEnumerable<string> registeredActions)
    {
        var (missingHandlers, missingSchemas) = FindMismatches(schemaActions, registeredActions);

        foreach (var action in missingHandlers)
        {
            _logger.Warning($"Schema action '{action}' has no registered C# handler.");
        }

        foreach (var action in missingSchemas)
        {
            _logger.Warning($"Handler action '{action}' has no matching schema definition.");
        }
    }

    /// <summary>
    /// Returns the set of schema actions without handlers and handler actions without schemas.
    /// Useful for testing that wiring is complete.
    /// </summary>
    internal static (List<string> MissingHandlers, List<string> MissingSchemas) FindMismatches(
        HashSet<string> schemaActions, IEnumerable<string> registeredActions)
    {
        var registered = new HashSet<string>(registeredActions, StringComparer.OrdinalIgnoreCase);
        var missingHandlers = new List<string>();
        var missingSchemas = new List<string>();

        foreach (var action in schemaActions)
        {
            if (!registered.Contains(action))
            {
                missingHandlers.Add(action);
            }
        }

        foreach (var action in registered)
        {
            if (!schemaActions.Contains(action))
            {
                missingSchemas.Add(action);
            }
        }

        return (missingHandlers, missingSchemas);
    }
}
