// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

using System.Diagnostics;

namespace TypeAgent.AIClient;

public class HttpRequestSettings
{
    public int MaxRetries { get; set; } = 3;

    public int RetryPauseMs { get; set; } = 1000;

    public int MaxRetryPauseMs { get; set; } = -1;

    public double JitterRange { get; set; } = 0.5;

    internal static readonly HttpRequestSettings Default = new();

    public int AdjustRetryPauseMs(int retryPauseMs)
    {
        if (JitterRange > 0 && JitterRange <= 1)
        {
            double jitterOffset = JitterRange / 2;
            double jitter = 1.0 - jitterOffset + (Random.Shared.NextDouble() * JitterRange);

            retryPauseMs = (int)(retryPauseMs * jitter);

        }
        if (MaxRetryPauseMs > 0)
        {
            retryPauseMs = Math.Min(retryPauseMs, MaxRetryPauseMs);
        }
        return retryPauseMs;
    }

}

/// <summary>
/// Extension methods for working with Http 
/// </summary>
public static class HttpEx
{
    internal static async Task<Response> GetJsonResponseAsync<Request, Response>(
        this HttpClient client,
        string endpoint,
        Request request,
        string? apiToken = null,
        HttpRequestSettings? settings = null,
        CancellationToken cancellationToken = default
    )
    {
        settings ??= HttpRequestSettings.Default;

        var requestMessage = Json.ToJsonMessage(request);
        int retryCount = 0;
        while (true)
        {
            HttpRequestMessage httpRequest = new HttpRequestMessage(HttpMethod.Post, endpoint)
            {
                Content = requestMessage
            };
            try
            {
                if (!string.IsNullOrEmpty(apiToken))
                {
                    httpRequest.Headers.Authorization = new AuthenticationHeaderValue("Bearer", apiToken);
                }


                HttpResponseMessage response = await client.SendAsync(httpRequest,cancellationToken).ConfigureAwait(false);
                if (response.StatusCode == HttpStatusCode.OK)
                {
                    using Stream stream = await response.Content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);
                    return Json.Parse<Response>(stream);
                }

                if (!response.StatusCode.IsTransientError() || retryCount >= settings.MaxRetries)
                {
                    // Let HttpClient throw an exception
                    response.EnsureSuccessStatusCode();
                    break;
                }

                retryCount++;

                int pauseMs = settings.RetryPauseMs > 0
                            ? settings.RetryPauseMs * (1 << retryCount) // Exponential backoff
                            : 0;

                if (response.StatusCode == (HttpStatusCode)429) // Too Many Requests
                {
                    pauseMs = GetRetryAfterMs(response, pauseMs);
                }
                if (pauseMs > 0)
                {
                    pauseMs = settings.AdjustRetryPauseMs(pauseMs);
                    await Task.Delay(pauseMs, cancellationToken).ConfigureAwait(false);
                }
            }
            finally
            {
                httpRequest.Dispose();
            }
        }
        throw new TypeAgentException("GetJsonResponse");
    }

    internal static bool IsTransientError(this HttpStatusCode status)
    {
        switch (status)
        {
            default:
                return false;

            case (HttpStatusCode)429: // Too many requests
            case HttpStatusCode.InternalServerError:
            case HttpStatusCode.BadGateway:
            case HttpStatusCode.ServiceUnavailable:
            case HttpStatusCode.GatewayTimeout:
                break;
        }

        return true;
    }

    /// <summary>
    /// When servers return a 429, they can include a Retry-After header that says how long the caller
    /// should wait before retrying.
    /// </summary>
    /// <param name="response">The HttpResponseMessage to inspect.</param>
    /// <param name="defaultValue">Default pause in milliseconds if header is missing or invalid.</param>
    /// <returns>Milliseconds to pause before retrying.</returns>
    internal static int GetRetryAfterMs(HttpResponseMessage response, int defaultValue)
    {
        int pauseMs = defaultValue;
        try
        {
            if (response.Headers.TryGetValues("Retry-After", out var values))
            {
                var pauseHeader = values.FirstOrDefault()?.Trim();
                if (!string.IsNullOrEmpty(pauseHeader))
                {
                    if (int.TryParse(pauseHeader, out int seconds))
                    {
                        pauseMs = seconds * 1000;
                    }
                    else if (DateTimeOffset.TryParse(pauseHeader, out var retryDate))
                    {
                        pauseMs = (int)(retryDate - DateTimeOffset.UtcNow).TotalMilliseconds;
                    }
                    if (pauseMs <= 0)
                    {
                        pauseMs = defaultValue;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Failed to parse Retry-After header: {ex}");
            pauseMs = defaultValue;
        }
        return pauseMs;
    }
}
