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
    /// <param name="key">The command key from the incoming JSON object.</param>
    /// <param name="value">The string representation of the command's value.</param>
    /// <param name="rawValue">The original JToken value for commands that need structured data.</param>
    void Handle(string key, string value, JToken rawValue);
}
