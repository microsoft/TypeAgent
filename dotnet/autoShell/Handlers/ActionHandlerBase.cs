// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text.Json;

namespace autoShell.Handlers;

/// <summary>
/// Base class for all action handlers. Co-registers action names and handler functions
/// via <see cref="AddAction"/> or <see cref="AddAction{T}"/>, providing automatic
/// <see cref="SupportedActions"/> and dictionary-based dispatch.
/// Subclasses register actions in their constructor.
/// </summary>
internal abstract class ActionHandlerBase : IActionHandler
{
    private static readonly JsonSerializerOptions CamelCaseOptions = new()
    {
        PropertyNameCaseInsensitive = true
    };

    private readonly Dictionary<string, Func<JsonElement, ActionResult>> _actions = new(StringComparer.OrdinalIgnoreCase);

    /// <inheritdoc/>
    public IEnumerable<string> SupportedActions => _actions.Keys;

    /// <summary>
    /// Registers an action name and its handler function. Throws if the name is already registered.
    /// </summary>
    protected void AddAction(string actionName, Func<JsonElement, ActionResult> handler)
    {
        if (!_actions.TryAdd(actionName, handler))
        {
            throw new InvalidOperationException(
                $"Action '{actionName}' is already registered in {GetType().Name}.");
        }
    }

    /// <summary>
    /// Registers an action with a strongly-typed parameter record.
    /// The <see cref="JsonElement"/> is automatically deserialized to <typeparamref name="T"/>.
    /// </summary>
    protected void AddAction<T>(string actionName, Func<T, ActionResult> handler)
    {
        AddAction(actionName, parameters =>
        {
            T typed;
            try
            {
                if (parameters.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null)
                {
                    return ActionResult.Fail($"Invalid parameters for '{actionName}': parameters are missing or null");
                }
                typed = JsonSerializer.Deserialize<T>(parameters.GetRawText(), CamelCaseOptions);
            }
            catch (JsonException ex)
            {
                return ActionResult.Fail($"Invalid parameters for '{actionName}': {ex.Message}");
            }
            return typed == null
                ? ActionResult.Fail($"Invalid parameters for '{actionName}': null parameters not allowed")
                : handler(typed);
        });
    }

    /// <inheritdoc/>
    public virtual ActionResult Handle(string key, JsonElement parameters)
    {
        return _actions.TryGetValue(key, out var handler)
            ? handler(parameters)
            : ActionResult.Fail($"Unknown action: {key}");
    }
}
