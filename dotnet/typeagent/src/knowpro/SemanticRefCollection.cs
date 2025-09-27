// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.


namespace TypeAgent.KnowPro;

public class SemanticRefCollection : ISemanticRefCollection
{
    public bool IsPersistent => false;

    public Task AppendAsync(SemanticRef item, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task AppendAsync(IEnumerable<SemanticRef> items, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<SemanticRef> GetAsync(int ordinal, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IList<SemanticRef>> GetAsync(IList<int> ordinals, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public IAsyncEnumerator<SemanticRef> GetAsyncEnumerator(CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<int> GetCountAsync(CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }

    public Task<IList<SemanticRef>> GetSliceAsync(int start, int end, CancellationToken cancellationToken = default)
    {
        throw new NotImplementedException();
    }
}
