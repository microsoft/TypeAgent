using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using NuGet.Frameworks;
using TypeAgent.Common;

namespace common.test;

public class LRUCacheTests
{
    [Fact]
    public void TestEviction()
    {
        LRUCache<int, int> cache = new(3);

        for(int i = 0; i < 5; i++)
        {
            cache.Add(i, i * 10);
        }

        Assert.Equal(3, cache.Count);
        Assert.False(cache.Contains(0));
        Assert.False(cache.TryGet(0, out _));
        Assert.True(cache.Contains(4));
        Assert.True(cache.TryGet(4, out _));
    }

    [Fact]
    public void TestUpdate()
    {
        LRUCache<int, int> cache = new(3);

        cache.Put(0, 0);
        cache.Put(0, 1);

        Assert.Equal(1, cache.Get(0));

        cache.Remove(0);
        Assert.Equal(0, cache.Count);
    }

    [Fact]
    public void TestClear()
    {
        LRUCache<int, int> cache = new(3);

        for (int i = 0; i < 5; i++)
        {
            cache.Add(i, i * 10);
        }

        cache.Clear();
        Assert.Equal(0, cache.Count);
    }

    [Fact]
    public void TestTrim()
    {
        LRUCache<int, int> cache = new(5);
        int purged = 0;
        cache.Purged += (kv) =>
        {
            purged++;
        };

        for (int i = 0; i < 5; i++)
        {
            cache.Add(i, i * 10);
        }

        cache.SetCount(3);
        Assert.Equal(2, cache.Count);
        Assert.Equal(3, purged);
    }
}
