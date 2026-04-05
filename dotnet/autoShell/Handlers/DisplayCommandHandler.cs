// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System;
using System.Collections.Generic;
using autoShell.Logging;
using autoShell.Services;
using Newtonsoft.Json.Linq;

namespace autoShell.Handlers;

/// <summary>
/// Handles display commands: ListResolutions, SetScreenResolution, and SetTextSize.
/// </summary>
internal class DisplayCommandHandler : ICommandHandler
{
    private readonly IDisplayService _display;
    private readonly ILogger _logger;

    public DisplayCommandHandler(IDisplayService display, ILogger logger)
    {
        _display = display;
        _logger = logger;
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
                    _logger.Error(ex);
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
                            _logger.Warning("Invalid resolution format. Use 'WIDTHxHEIGHT' or 'WIDTHxHEIGHT@REFRESH' (e.g., '1920x1080' or '1920x1080@60')");
                            return;
                        }

                        if (!uint.TryParse(parts[0].Trim(), out width) || !uint.TryParse(parts[1].Trim(), out height))
                        {
                            _logger.Warning("Invalid resolution values. Width and height must be positive integers.");
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
                    _logger.Error(ex);
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
                    _logger.Error(ex);
                }
                break;
        }
    }
}
