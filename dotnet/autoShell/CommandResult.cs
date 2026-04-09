// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using Newtonsoft.Json;
using Newtonsoft.Json.Linq;

namespace autoShell;

/// <summary>
/// Represents the result of executing a command handler.
/// Serialized to JSON and written to stdout as the response to the caller.
/// </summary>
internal class CommandResult
{
    [JsonProperty("id", NullValueHandling = NullValueHandling.Ignore)]
    public string Id { get; set; }

    [JsonProperty("success")]
    public bool Success { get; init; }

    [JsonProperty("message")]
    public string Message { get; init; }

    [JsonProperty("data", NullValueHandling = NullValueHandling.Ignore)]
    public JToken Data { get; init; }

    /// <summary>
    /// When true, the caller should exit the interactive loop after sending this result.
    /// Not serialized — this is internal control flow only.
    /// </summary>
    [JsonIgnore]
    public bool IsQuit { get; init; }

    /// <summary>
    /// Creates a successful result with a message.
    /// </summary>
    public static CommandResult Ok(string message) =>
        new() { Success = true, Message = message };

    /// <summary>
    /// Creates a successful result with a message and associated data.
    /// </summary>
    public static CommandResult Ok(string message, JToken data) =>
        new() { Success = true, Message = message, Data = data };

    /// <summary>
    /// Creates a failure result with an error message.
    /// </summary>
    public static CommandResult Fail(string message) =>
        new() { Success = false, Message = message };

    /// <summary>
    /// Creates a successful quit result that signals the interactive loop to exit.
    /// </summary>
    public static CommandResult Quit() =>
        new() { Success = true, Message = "Quitting", IsQuit = true };
}
