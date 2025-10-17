// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// Exception thrown by TypeChat objects
/// </summary>
public class TypeChatException : Exception
{
    private static class ErrorMessages
    {
        public const string NoJsonReturned = "The response is not Json";
        public const string IncompleteJson = "Json Object is incomplete";
    }

    /// <summary>
    /// Error code associated with the exception
    /// </summary>
    public enum ErrorCode
    {
        /// <summary>
        /// Unknown error
        /// </summary>
        Unknown,
        /// <summary>
        /// No Json object returned by the model
        /// </summary>
        NoJsonObject,
        /// <summary>
        /// Json validation failed
        /// </summary>
        JsonValidation,
        /// <summary>
        /// There is no suitable translator this request
        /// </summary>
        NoTranslator
    }

    private readonly string _request;
    private readonly ErrorCode _errorCode;
    private readonly JsonResponse? _response;

    public TypeChatException(ErrorCode code, string request, JsonResponse? response = null, string? message = null)
        : base(message)
    {
        _errorCode = code;
        _request = request;
        _response = response;
    }

    /// <summary>
    /// Error code
    /// </summary>
    public ErrorCode Code => _errorCode;

    /// <summary>
    /// The request string that caused the error
    /// </summary>
    public string Request => _request;

    /// <summary>
    /// The response, if any, that caused the error
    /// </summary>
    public JsonResponse? Response => _response;

    public override string ToString()
    {
        return $"Error: {Code}\n{Message}\n\nRequest:\n{Request}\n\nResponse:\n{Response.ResponseText}";
    }

    internal static void ThrowNoJson(string request, JsonResponse response)
    {
        throw new TypeChatException(
            TypeChatException.ErrorCode.NoJsonObject,
            request,
            response,
            TypeChatException.ErrorMessages.NoJsonReturned
            );
    }

    internal static void ThrowJsonValidation(string request, JsonResponse response, string message)
    {
        throw new TypeChatException(
            TypeChatException.ErrorCode.JsonValidation,
            request,
            response,
            message
            );
    }

    internal static string NoJson(JsonResponse response)
    {
        return $"{TypeChatException.ErrorMessages.NoJsonReturned}:\n{response.ResponseText}";
    }

    internal static string IncompleteJson(JsonResponse response)
    {
        return $"{TypeChatException.ErrorMessages.IncompleteJson}:\n{response.Json}";
    }
}
