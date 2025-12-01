// Copyright (c) Microsoft. All rights reserved.

using System.Net;

namespace TypeAgent.TestLib;

public class MockHttpHandler : HttpMessageHandler
{
    public MockHttpHandler(string? jsonResponse = null)
    {
        JsonResponse = jsonResponse;
    }

    public MockHttpHandler(int statusCode = 0)
    {
        StatusCode = statusCode;
    }

    public int StatusCode { get; set; } = 0;
    public string? JsonResponse { get; set; } = null;
    public HttpResponseMessage? Response { get; set; }


    public int RequestCount { get; set; } = 0;
    public HttpRequestMessage? LastRequest { get; set; }

    public void Clear()
    {
        RequestCount = 0;
        LastRequest = null;
    }

    protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        LastRequest = request;
        RequestCount++;
        HttpResponseMessage response = Response;
        if (response is null)
        {
            response = new HttpResponseMessage();
            if (!string.IsNullOrEmpty(JsonResponse))
            {
                response.SetJson(JsonResponse);
            }
            if (StatusCode > 0)
            {
                response.StatusCode = (HttpStatusCode)StatusCode;
            }
        }

        return Task.FromResult(response);
    }

    public static MockHttpHandler ErrorResponder(int statusCode)
    {
        return new MockHttpHandler(statusCode);
    }
}
