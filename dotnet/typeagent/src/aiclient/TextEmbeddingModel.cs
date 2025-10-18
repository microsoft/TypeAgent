// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.AIClient;

public class TextEmbeddingModel : OpenAIModel, ITextEmbeddingModel
{
    int _dimensions;

    public TextEmbeddingModel(OpenAIConfig config, HttpClient? client = null, int dimensions = 0)
        : base(config, client)
    {
        _dimensions = dimensions;
    }

    public async Task<float[]> GenerateAsync(string input, CancellationToken cancellationToken)
    {
        Response response = await GetResponseAsync([input], cancellationToken);
        return response.data[0].embedding;
    }

    public async Task<IList<float[]>> GenerateAsync(string[] inputs, CancellationToken cancellationToken)
    {
        Response response = await GetResponseAsync(inputs, cancellationToken);
        return response.data.Map((m) => m.embedding);
    }

    private async Task<Response> GetResponseAsync(string[] inputs, CancellationToken cancellationToken)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(inputs, nameof(inputs));

        Request request = CreateRequest(inputs);
        string? apiToken = Config.HasTokenProvider
                    ? await Config.ApiTokenProvider.GetAccessTokenAsync(cancellationToken)
                    : null;

        Response response = await Client.GetJsonResponseAsync<Request, Response>(
            Endpoint,
            request,
            apiToken,
            RequestSettings,
            cancellationToken
        ).ConfigureAwait(false);

        response.ThrowIfInvalid();

        return response;
    }


    private Request CreateRequest(string[] input)
    {
        var request = new Request
        {
            input = input
        };
        if (_dimensions > 0)
        {
            request.dimensions = _dimensions;
        }
        if (!Config.Azure)
        {
            request.model = Model.Name;
        }
        return request;
    }

    private struct Request
    {
        public string? model { get; set; }
        public int? dimensions { get; set; }
        public string[] input { get; set; }
    }

    private struct Response
    {
        public EmbeddingData[] data { get; set; }

        public void ThrowIfInvalid()
        {
            if (data is null || data.Length == 0)
            {
                throw new AIClientException(AIClientException.ErrorCode.InvalidEmbeddingResponse);
            }
        }
    };

    private struct EmbeddingData
    {
        public float[] embedding { get; set; }
    }
}
