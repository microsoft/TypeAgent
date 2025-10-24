// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.AIClient;

public class TextEmbeddingModel : ModelApi, ITextEmbeddingModel
{
    int _dimensions;

    public TextEmbeddingModel(ModelApiSettings settings, int dimensions = 0, int maxBatchSize = 2048)
        : this(settings, null, dimensions, maxBatchSize)
    {
    }

    public TextEmbeddingModel(
        ModelApiSettings settings,
        HttpClient? client,
        int dimensions = 0,
        int maxBatchSize = 2048
    )
        : base(settings, client)
    {
        _dimensions = dimensions;
        MaxBatchSize = maxBatchSize;
    }

    public int MaxBatchSize { get; }

    public async Task<float[]> GenerateAsync(string input, CancellationToken cancellationToken)
    {
        Response response = await GetResponseAsync([input], cancellationToken).ConfigureAwait(false);
        return response.data[0].embedding;
    }

    public async Task<IList<float[]>> GenerateAsync(IList<string> inputs, CancellationToken cancellationToken)
    {
        Response response = await GetResponseAsync(inputs, cancellationToken).ConfigureAwait(false);
        return response.data.Map((m) => m.embedding);
    }

    private async Task<Response> GetResponseAsync(IList<string> inputs, CancellationToken cancellationToken)
    {
        ArgumentVerify.ThrowIfNullOrEmpty(inputs, nameof(inputs));

        Request request = CreateRequest(inputs);
        string? apiToken = Settings.ApiTokenProvider is not null
                    ? await Settings.ApiTokenProvider.GetAccessTokenAsync(cancellationToken).ConfigureAwait(false)
                    : null;

        Response response = await Client.GetJsonResponseAsync<Request, Response>(
            Settings.Endpoint,
            request,
            apiToken,
            Settings.Retry,
            cancellationToken
        ).ConfigureAwait(false);

        response.ThrowIfInvalid();

        return response;
    }

    private Request CreateRequest(IList<string> input)
    {
        var request = new Request
        {
            input = input
        };
        if (_dimensions > 0)
        {
            request.dimensions = _dimensions;
        }
        if (!string.IsNullOrEmpty(Settings.ModelName))
        {
            request.model = Settings.ModelName;
        }
        return request;
    }

    private struct Request
    {
        public string? model { get; set; }
        public int? dimensions { get; set; }
        public IList<string> input { get; set; }
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
