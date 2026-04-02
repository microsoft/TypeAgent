// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Handlers;
using autoShell.Handlers.Settings;
using autoShell.Logging;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell;

/// <summary>
/// Routes incoming JSON commands to the appropriate handler via a direct dictionary lookup.
/// </summary>
internal class CommandDispatcher
{
    private readonly Dictionary<string, ICommandHandler> _handlers = [];
    private readonly ILogger _logger;

    public CommandDispatcher(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Creates a CommandDispatcher with all production services and handlers registered.
    /// </summary>
    public static CommandDispatcher Create(ILogger logger)
    {
        var registry = new WindowsRegistryService();
        var systemParams = new WindowsSystemParametersService();
        var process = new WindowsProcessService();
        var audio = new WindowsAudioService(logger);
        var appRegistry = new WindowsAppRegistry(logger);
        var debugger = new WindowsDebuggerService();
        var brightness = new WindowsBrightnessService(logger);
        var display = new WindowsDisplayService(logger);
        var window = new WindowsWindowService(logger);
        var network = new WindowsNetworkService(logger);
        var virtualDesktop = new WindowsVirtualDesktopService(logger);

        var dispatcher = new CommandDispatcher(logger);
        dispatcher.Register(
            new AudioCommandHandler(audio),
            new AppCommandHandler(appRegistry, process, window, logger),
            new WindowCommandHandler(appRegistry, window),
            new ThemeCommandHandler(registry, process, systemParams),
            new VirtualDesktopCommandHandler(appRegistry, process, virtualDesktop, logger),
            new NetworkCommandHandler(network, logger),
            new DisplayCommandHandler(display, logger),
            new TaskbarSettingsHandler(registry),
            new DisplaySettingsHandler(registry, process, brightness, logger),
            new PersonalizationSettingsHandler(registry, process),
            new MouseSettingsHandler(systemParams, process, logger),
            new AccessibilitySettingsHandler(registry, process),
            new PrivacySettingsHandler(registry),
            new PowerSettingsHandler(registry, process),
            new FileExplorerSettingsHandler(registry),
            new SystemSettingsHandler(registry, process, logger),
            new SystemCommandHandler(process, debugger)
        );

        return dispatcher;
    }

    /// <summary>
    /// Registers one or more command handlers with the dispatcher.
    /// </summary>
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
    /// </summary>
    /// <returns>True if a "quit" command was encountered; otherwise false.</returns>
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
                    _logger.Debug("Unknown command: " + key);
                }
            }
            catch (Exception ex)
            {
                _logger.Error(ex);
            }
        }
        return false;
    }
}
