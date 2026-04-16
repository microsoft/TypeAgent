// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Text.Json;
using System.Text.Json.Serialization;

namespace autoShell;

/// <summary>
/// Represents the result of executing an action.
/// Serialized to JSON and written to stdout as the response to the caller.
/// </summary>
internal class ActionResult
{
    [JsonPropertyName("id")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string Id { get; set; }

    [JsonPropertyName("success")]
    public bool Success { get; init; }

    [JsonPropertyName("message")]
    public string Message { get; init; }

    [JsonPropertyName("data")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public JsonElement? Data { get; init; }

    /// <summary>
    /// When true, the caller should exit the interactive loop after sending this result.
    /// Not serialized — this is internal control flow only.
    /// </summary>
    [JsonIgnore]
    public bool IsQuit { get; init; }

    /// <summary>
    /// Creates a successful result with a message.
    /// </summary>
    public static ActionResult Ok(string message) =>
        new() { Success = true, Message = message };

    /// <summary>
    /// Creates a successful result with a message and associated data.
    /// </summary>
    public static ActionResult Ok(string message, JsonElement data) =>
        new() { Success = true, Message = message, Data = data };

    /// <summary>
    /// Creates a failure result with an error message.
    /// </summary>
    public static ActionResult Fail(string message) =>
        new() { Success = false, Message = message };

    /// <summary>
    /// Creates a successful quit result that signals the interactive loop to exit.
    /// </summary>
    public static ActionResult Quit() =>
        new() { Success = true, Message = "Quitting", IsQuit = true };
}
