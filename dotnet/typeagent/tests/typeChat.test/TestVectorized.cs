// Copyright (c) Microsoft. All rights reserved.

using TypeAgent.Common;
using TypeAgent.Vector;

namespace Microsoft.TypeChat.Tests;

public class TestVectorized
{
    [Fact]
    public void TestSerialize_Embedding()
    {
        List<Embedding> list = new List<Embedding>();
        for (int i = 0; i < 4; ++i)
        {
            list.Add(Random.Shared.FloatArray(8));
        }
        string json = Json.Stringify(list, false);
        List<Embedding> listBack = Json.Parse<List<Embedding>>(json) ?? [];

        Assert.Equal(list.Count, listBack.Count);
        for (int i = 0; i < list.Count; ++i)
        {
            ValidateEqual(list[i], listBack[i]);
        }
    }

    //[Fact]
    //public void TestSerialize_VectorList()
    //{
    //    KeyValuePair<string, Embedding> kv = new KeyValuePair<string, Embedding>("foo", Random.Shared.FloatArray(4));
    //    string json = Json.Stringify(kv);
    //    kv = Json.Parse<KeyValuePair<string, Embedding>>(json);

    //    VectorizedList<string> list = new VectorizedList<string>();
    //    list.Add("one", Random.Shared.FloatArray(8));
    //    list.Add("two", Random.Shared.FloatArray(8));

    //    json = Json.Stringify(list);
    //    VectorizedList<string> listBack = Json.Parse<VectorizedList<string>>(json);

    //    Assert.Equal(list.Count, listBack.Count);
    //}

    [Fact]
    public void TestEmbedding()
    {
        const int EmbeddingSize = 1536;
        Embedding x = Random.Shared.FloatArray(EmbeddingSize);
        Embedding y = Random.Shared.FloatArray(EmbeddingSize);

        double cos1 = x.CosineSimilarity(y);

        x.NormalizeInPlace();
        y.NormalizeInPlace();
        double dot2 = x.DotProduct(y);
        Assert.Equal(Degrees(cos1), Degrees(dot2));
    }

    //[Fact]
    //public void TestVectorizedList()
    //{
    //    VectorizedList<string> list = new VectorizedList<string>(16);
    //    Assert.Equal(0, list.Count);

    //    const int embeddingSize = 8;
    //    const int numItems = 10;
    //    int i = 0;
    //    for (; i < numItems; ++i)
    //    {
    //        list.Add(i.ToString(), Random.Shared.FloatArray(embeddingSize));
    //    }

    //    const int i_test = 5;
    //    string i_test_str = i_test.ToString();
    //    Assert.Equal(i_test, list.IndexOf(i_test_str));
    //    var kv = new KeyValuePair<string, Embedding>(i_test_str, list.GetEmbedding(5));
    //    Assert.True(list.Contains(kv));

    //    // Test search
    //    Embedding testEmbedding = list.GetEmbedding(i_test);
    //    int iNearest = list.IndexOfNearest(testEmbedding, EmbeddingDistance.Cosine);
    //    Assert.Equal(i_test, iNearest);
    //    Assert.Equal(i_test_str, list.Nearest(testEmbedding, EmbeddingDistance.Cosine));

    //    var matches = list.Nearest(testEmbedding, 5, EmbeddingDistance.Dot).ToList();
    //    Assert.Equal(5, matches.Count);
    //    matches = list.Nearest(testEmbedding, 5, EmbeddingDistance.Cosine).ToList();
    //    Assert.Equal(5, matches.Count);
    //    int iDotNearest = list.IndexOfNearest(testEmbedding, EmbeddingDistance.Dot);
    //    Assert.NotEqual(-1, iDotNearest);

    //    // Test remove
    //    Assert.True(list.Remove(i_test_str));
    //    Assert.True(list.Count == numItems - 1);
    //    Assert.False(list.Remove(i_test_str));
    //}

    private void ValidateEqual(Embedding x, Embedding y)
    {
        Assert.Equal(x.Vector.Length, y.Vector.Length);
        bool cmp = false;
        for (int i = 0; i < x.Vector.Length; ++i)
        {
            cmp = x.Vector[i] == y.Vector[i];
        }
        Assert.True(cmp);
    }

    private int Degrees(double cosine)
    {
        double angle = Math.Acos(cosine); // In radians
        return (180 / Math.PI * angle).RoundToInt();
    }

}

