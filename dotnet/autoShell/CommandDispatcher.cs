// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using autoShell.Handlers;
using autoShell.Handlers.Settings;
using autoShell.Logging;
using autoShell.Services;

namespace autoShell;

/// <summary>
/// Routes incoming JSON commands to the appropriate handler via a direct dictionary lookup.
/// </summary>
internal class CommandDispatcher
{
    private readonly Dictionary<string, ICommandHandler> _handlers = new(StringComparer.OrdinalIgnoreCase);
    private readonly ILogger _logger;

    public CommandDispatcher(ILogger logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Gets the names of all registered commands.
    /// </summary>
    public IEnumerable<string> RegisteredCommands => _handlers.Keys;

    /// <summary>
    /// Creates a <see cref="CommandDispatcher"/> with all production services and handlers registered.
    /// </summary>
    public static CommandDispatcher Create(ILogger logger)
    {
        return Create(
            logger,
            new WindowsRegistryService(),
            new WindowsSystemParametersService(),
            new WindowsProcessService(),
            new WindowsAudioService(logger),
            new WindowsAppRegistry(logger),
            new WindowsDebuggerService(),
            new WindowsBrightnessService(logger),
            new WindowsDisplayService(logger),
            new WindowsWindowService(logger),
            new WindowsNetworkService(logger),
            new WindowsVirtualDesktopService(logger)
        );
    }

    /// <summary>
    /// Creates a <see cref="CommandDispatcher"/> with the specified services, enabling integration testing
    /// with mock services while exercising real handler wiring.
    /// </summary>
    internal static CommandDispatcher Create(
        ILogger logger,
        IRegistryService registry,
        ISystemParametersService systemParams,
        IProcessService process,
        IAudioService audio,
        IAppRegistry appRegistry,
        IDebuggerService debugger,
        IBrightnessService brightness,
        IDisplayService display,
        IWindowService window,
        INetworkService network,
        IVirtualDesktopService virtualDesktop)
    {
        var dispatcher = new CommandDispatcher(logger);
        dispatcher.Register(
            new AudioCommandHandler(audio),
            new AppCommandHandler(appRegistry, process, window, logger),
            new WindowCommandHandler(appRegistry, window),
            new ThemeCommandHandler(registry, process, systemParams),
            new VirtualDesktopCommandHandler(appRegistry, window, virtualDesktop, logger),
            new NetworkCommandHandler(network, process, logger),
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

        var validator = new SchemaValidator(logger);
        var schemaDir = Path.Combine(AppContext.BaseDirectory, SchemaValidator.DefaultSchemaRelativePath);
        var schemaActions = validator.LoadActionNames(schemaDir);
        if (schemaActions.Count > 0)
        {
            validator.ValidateWiring(schemaActions, dispatcher.RegisteredCommands);
        }

        return dispatcher;
    }

    /// <summary>
    /// Registers one or more command handlers with the dispatcher.
    /// Throws if a command name is already registered.
    /// </summary>
    public void Register(params ICommandHandler[] handlers)
    {
        foreach (var handler in handlers)
        {
            foreach (string command in handler.SupportedCommands)
            {
                if (!_handlers.TryAdd(command, handler))
                {
                    throw new InvalidOperationException(
                        $"Command '{command}' is already registered by {_handlers[command].GetType().Name}. " +
                        $"Cannot register again from {handler.GetType().Name}.");
                }
            }
        }
    }

    /// <summary>
    /// Dispatches a command in the format <c>{"actionName":"Volume","parameters":{"targetVolume":50}}</c>
    /// to the appropriate handler.
    /// </summary>
    /// <returns>
    /// A <see cref="CommandResult"/> for the executed command. Check <see cref="CommandResult.IsQuit"/>
    /// to determine if the caller should exit the interactive loop.
    /// </returns>
    public CommandResult Dispatch(JsonElement root)
    {
        string actionName = root.TryGetProperty("actionName", out JsonElement actionNameElement)
            ? actionNameElement.GetString()
            : null;
        if (string.IsNullOrEmpty(actionName))
        {
            return CommandResult.Fail("Missing actionName in command JSON");
        }

        if (string.Equals(actionName, "quit", StringComparison.OrdinalIgnoreCase))
        {
            return CommandResult.Quit();
        }

        JsonElement parameters = root.TryGetProperty("parameters", out JsonElement p)
            ? p
            : default;

        try
        {
            return _handlers.TryGetValue(actionName, out ICommandHandler handler)
                ? handler.Handle(actionName, parameters)
                : CommandResult.Fail($"Unknown action: {actionName}");
        }
        catch (Exception ex)
        {
            _logger.Error(ex);
            return CommandResult.Fail($"Error executing {actionName}: {ex.Message}");
        }
    }
}
