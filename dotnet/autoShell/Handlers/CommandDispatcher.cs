// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Routes incoming JSON commands to the appropriate handler via a direct dictionary lookup.
/// </summary>
internal class CommandDispatcher
{
    private readonly Dictionary<string, ICommandHandler> _handlers = [];

    public void Register(params ICommandHandler[] handlers)
    {
        foreach (var handler in handlers)
        {
            foreach (string command in handler.SupportedCommands)
            {
                _handlers[command] = handler;
            }
        }
    }

    /// <summary>
    /// Dispatches all commands in a JSON object to their handlers.
    /// Returns true if the application should quit.
    /// </summary>
    public bool Dispatch(JObject root)
    {
        foreach (var kvp in root)
        {
            string key = kvp.Key;

            if (key == "quit")
            {
                return true;
            }

            string value = kvp.Value.ToString();

            try
            {
                if (_handlers.TryGetValue(key, out ICommandHandler handler))
                {
                    handler.Handle(key, value, kvp.Value);
                }
                else
                {
                    Debug.WriteLine("Unknown command: " + key);
                }
            }
            catch (Exception ex)
            {
                AutoShell.LogError(ex);
            }
        }
        return false;
    }
}
