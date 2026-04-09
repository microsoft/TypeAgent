// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using System.Text.Json;

namespace autoShell.Handlers;

/// <summary>
/// Interface for command handlers that process autoShell actions.
/// </summary>
internal interface ICommandHandler
{
    /// <summary>
    /// Returns the set of command keys this handler supports.
    /// </summary>
    IEnumerable<string> SupportedCommands { get; }

    /// <summary>
    /// Handles the command identified by <paramref name="key"/>.
    /// </summary>
    /// <param name="key">The command key (action name).</param>
    /// <param name="parameters">The action parameters as a read-only JsonElement.</param>
    /// <returns>A <see cref="CommandResult"/> describing the outcome.</returns>
    CommandResult Handle(string key, JsonElement parameters);
}
