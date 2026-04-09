// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using System.Text.Json;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles privacy settings: camera, location, and microphone access.
/// </summary>
internal class PrivacySettingsHandler : ICommandHandler
{
    private const string ConsentStoreBase = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

    private readonly IRegistryService _registry;

    public PrivacySettingsHandler(IRegistryService registry)
    {
        _registry = registry;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ManageCameraAccess",
        "ManageLocationAccess",
        "ManageMicrophoneAccess",
    ];

    /// <inheritdoc/>
    public CommandResult Handle(string key, JsonElement parameters)
    {
        string subKey = key switch
        {
            "ManageCameraAccess" => "webcam",
            "ManageLocationAccess" => "location",
            "ManageMicrophoneAccess" => "microphone",
            _ => null,
        };

        return subKey == null ? CommandResult.Fail($"Unknown privacy command: {key}") : SetAccessSetting(parameters, subKey, key);
    }

    private CommandResult SetAccessSetting(JsonElement parameters, string capability, string commandName)
    {
        string setting = parameters.GetStringOrDefault("accessSetting", "Allow");
        string regValue = setting.Equals("deny", StringComparison.OrdinalIgnoreCase) ? "Deny" : "Allow";

        _registry.SetValue(
            ConsentStoreBase + @"\" + capability,
            "Value",
            regValue,
            RegistryValueKind.String);

        return CommandResult.Ok($"{capability} access set to {regValue}");
    }
}
