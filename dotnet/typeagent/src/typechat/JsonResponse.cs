// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat;

/// <summary>
/// Models can return Json responses that contain (possibly) valid Json surrounded by
/// both prologue and epilogue text. 
/// </summary>
public class JsonResponse
{
    public JsonResponse(string responseText)
    {
        ResponseText = responseText;
        HasCompleteJson = false;
    }

    /// <summary>
    /// Raw response text
    /// </summary>
    public string ResponseText { get; private set; }

    /// <summary>
    /// Any text contained within outer-most braces only: {} and can be passed to a Json
    /// parser or serializer for further validation
    /// </summary>
    public string? Json { get; private set; }

    /// <summary>
    /// Anything the model returned before the Json
    /// </summary>
    public string? Prologue { get; private set; }

    /// <summary>
    /// Anything the model returned after the Json
    /// </summary>
    public string? Epilogue { get; private set; }

    /// <summary>
    /// Was the json at least enclosed in outer braces? {} 
    /// </summary>
    public bool HasCompleteJson { get; private set; }

    public bool HasJson => !string.IsNullOrEmpty(Json);
    public bool HasPrologue => !string.IsNullOrEmpty(Prologue);
    public bool HasEpilogue => !string.IsNullOrEmpty(Epilogue);

    // Message combines Prologue and Epilogue
    public string? Message()
    {
        if (HasPrologue || HasEpilogue)
        {
            return string.Join("\n", Prologue, Epilogue);
        }
        return null;
    }
    /// <summary>
    /// Parse the given json response into its parts
    /// </summary>
    /// <param name="responseText">response text</param>
    /// <returns>JsonResponse object</returns>
    public static JsonResponse Parse(string responseText)
    {
        JsonResponse response = new JsonResponse(responseText);
        if (string.IsNullOrEmpty(responseText))
        {
            return response;
        }
        int lastIndex = responseText.Length - 1;
        int iJsonStartAt = responseText.IndexOf('{');
        int iJsonEndAt = responseText.LastIndexOf('}');

        if (iJsonStartAt < 0)
        {
            // No Json. Treat everything as Prologue
            response.Prologue = responseText;
            return response;
        }

        response.HasCompleteJson = false; // { indicates that Json was attempted
        if (iJsonStartAt > 0)
        {
            // Prologue precedes Json
            response.Prologue = responseText.Substring(0, iJsonStartAt);
        }
        if (iJsonEndAt < 0)
        {
            // Incomplete json. Treat remaining text as epilogue
            response.Json = responseText.Substring(iJsonStartAt, lastIndex - iJsonStartAt);
            return response;
        }

        response.Json = responseText.Substring(iJsonStartAt, (iJsonEndAt - iJsonStartAt) + 1);
        response.HasCompleteJson = true; // We have at least {}
        ++iJsonEndAt;
        if (iJsonEndAt < lastIndex)
        {
            // Epilogue follows json
            response.Epilogue = responseText.Substring(iJsonEndAt, (lastIndex - iJsonEndAt) + 1);
        }
        return response;
    }
}
