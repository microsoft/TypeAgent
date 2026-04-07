// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using Newtonsoft.Json.Linq;

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
    /// <param name="parameters">The action parameters as a JObject.</param>
    void Handle(string key, JObject parameters);
}
