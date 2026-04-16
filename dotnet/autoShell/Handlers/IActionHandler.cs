// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.Json;

namespace autoShell.Handlers;

/// <summary>
/// Interface for handlers that process autoShell actions.
/// </summary>
internal interface IActionHandler
{
    /// <summary>
    /// Returns the set of action names this handler supports.
    /// </summary>
    IEnumerable<string> SupportedActions { get; }

    /// <summary>
    /// Handles the action identified by <paramref name="key"/>.
    /// </summary>
    /// <param name="key">The action name.</param>
    /// <param name="parameters">The action parameters as a read-only JsonElement.</param>
    /// <returns>A <see cref="ActionResult"/> describing the outcome.</returns>
    ActionResult Handle(string key, JsonElement parameters);
}
