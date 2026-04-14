// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Collections.Generic;
using autoShell.Services;
using Microsoft.Win32;

namespace autoShell.Handlers.Settings;

/// <summary>
/// Handles privacy settings: camera, location, and microphone access.
/// </summary>
internal class PrivacySettingsHandler : SettingsHandlerBase
{
    private const string ConsentStoreBase = @"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

    /// <summary>
    /// Registers registered actions for all privacy settings: camera, location, and microphone access.
    /// All actions use the registry map pattern — no custom logic needed.
    /// </summary>
    public PrivacySettingsHandler(IRegistryService registry)
        : base(registry)
    {
        AddRegistryMapAction("ManageCameraAccess", new RegistryMapConfig(
            ConsentStoreBase + @"\webcam", "Value", "accessSetting",
            new Dictionary<string, object> { ["deny"] = "Deny" }, DefaultValue: "Allow",
            ValueKind: RegistryValueKind.String, DisplayName: "webcam access"));
        AddRegistryMapAction("ManageLocationAccess", new RegistryMapConfig(
            ConsentStoreBase + @"\location", "Value", "accessSetting",
            new Dictionary<string, object> { ["deny"] = "Deny" }, DefaultValue: "Allow",
            ValueKind: RegistryValueKind.String, DisplayName: "location access"));
        AddRegistryMapAction("ManageMicrophoneAccess", new RegistryMapConfig(
            ConsentStoreBase + @"\microphone", "Value", "accessSetting",
            new Dictionary<string, object> { ["deny"] = "Deny" }, DefaultValue: "Allow",
            ValueKind: RegistryValueKind.String, DisplayName: "microphone access"));
    }
}
