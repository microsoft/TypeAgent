// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text.Json;

namespace autoShell.Handlers;

/// <summary>
/// Base class for all action handlers. Co-registers action names and handler functions
/// via <see cref="AddAction"/>, providing automatic <see cref="SupportedActions"/>
/// and dictionary-based dispatch. Subclasses register actions in their constructor.
/// </summary>
internal abstract class ActionHandlerBase : IActionHandler
{
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

    /// <inheritdoc/>
    public virtual ActionResult Handle(string key, JsonElement parameters)
    {
        return _actions.TryGetValue(key, out var handler)
            ? handler(parameters)
            : ActionResult.Fail($"Unknown action: {key}");
    }
}
