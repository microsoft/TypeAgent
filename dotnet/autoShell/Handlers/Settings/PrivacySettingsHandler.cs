// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Services;
using Microsoft.Win32;
using Newtonsoft.Json.Linq;

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
    public void Handle(string key, string value, JToken rawValue)
    {
        var param = JObject.Parse(value);

        string subKey = key switch
        {
            "ManageCameraAccess" => "webcam",
            "ManageLocationAccess" => "location",
            "ManageMicrophoneAccess" => "microphone",
            _ => null,
        };

        if (subKey != null)
        {
            SetAccessSetting(param, subKey);
        }
    }

    private void SetAccessSetting(JObject param, string capability)
    {
        string setting = param.Value<string>("accessSetting") ?? "Allow";
        string regValue = setting.Equals("deny", StringComparison.OrdinalIgnoreCase) ? "Deny" : "Allow";

        _registry.SetValue(
            ConsentStoreBase + @"\" + capability,
            "Value",
            regValue,
            RegistryValueKind.String);
    }
}
