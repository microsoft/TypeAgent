// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles display commands: ListResolutions, SetScreenResolution, and SetTextSize.
/// </summary>
internal class DisplayCommandHandler : ICommandHandler
{
    private readonly IDisplayService _display;

    public DisplayCommandHandler(IDisplayService display)
    {
        _display = display;
    }

    /// <inheritdoc/>
    public IEnumerable<string> SupportedCommands { get; } =
    [
        "ListResolutions",
        "SetScreenResolution",
        "SetTextSize",
    ];

    /// <inheritdoc/>
    public void Handle(string key, string value, JToken rawValue)
    {
        switch (key)
        {
            case "ListResolutions":
                try
                {
                    Console.WriteLine(_display.ListResolutions());
                }
                catch (Exception ex)
                {
                    AutoShell.LogError(ex);
                }
                break;

            case "SetScreenResolution":
                try
                {
                    uint width;
                    uint height;
                    uint? refreshRate = null;

                    if (rawValue.Type == JTokenType.Object)
                    {
                        width = rawValue.Value<uint>("width");
                        height = rawValue.Value<uint>("height");
                        if (rawValue["refreshRate"] != null)
                        {
                            refreshRate = rawValue.Value<uint>("refreshRate");
                        }
                    }
                    else
                    {
                        string resString = rawValue.ToString();
                        string[] parts = resString.ToLowerInvariant().Split('x', '@');
                        if (parts.Length < 2)
                        {
                            AutoShell.LogWarning("Invalid resolution format. Use 'WIDTHxHEIGHT' or 'WIDTHxHEIGHT@REFRESH' (e.g., '1920x1080' or '1920x1080@60')");
                            return;
                        }

                        if (!uint.TryParse(parts[0].Trim(), out width) || !uint.TryParse(parts[1].Trim(), out height))
                        {
                            AutoShell.LogWarning("Invalid resolution values. Width and height must be positive integers.");
                            return;
                        }

                        if (parts.Length >= 3 && uint.TryParse(parts[2].Trim(), out uint parsedRefresh))
                        {
                            refreshRate = parsedRefresh;
                        }
                    }

                    string result = _display.SetResolution(width, height, refreshRate);
                    Console.WriteLine(result);
                }
                catch (Exception ex)
                {
                    AutoShell.LogError(ex);
                }
                break;

            case "SetTextSize":
                try
                {
                    if (int.TryParse(value, out int textSizePct))
                    {
                        _display.SetTextSize(textSizePct);
                    }
                }
                catch (Exception ex)
                {
                    AutoShell.LogError(ex);
                }
                break;
        }
    }
}
