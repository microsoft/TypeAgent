// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

namespace Microsoft.TypeChat.Tests;

public class TestConstraints : TypeChatTest
{
    [Fact]
    public void Test_Valid()
    {
        // Valid object
        Person person = new Person();
        person.Name = new Name
        {
            FirstName = "Mario",
            LastName = "Minderbinder"
        };
        person.Age = 45;

        ConstraintsValidator<Person> validator = new ConstraintsValidator<Person>();
        Result<Person> result = validator.Validate(person);
        Assert.True(result.Success);
        Assert.Same(result.Value, person);
    }

    [Fact]
    public void Test_Fail()
    {
        ConstraintsValidator<Person> validator = new ConstraintsValidator<Person>();

        // Names too long
        Person person = new Person();
        person.Name = new Name
        {
            FirstName = new string('f', 64),
            LastName = new string('l', 34)
        };
        person.Age = 45;

        Result<Person> result = validator.Validate(person);
        Assert.False(result.Success);
        Assert.True(result.Message?.Length > 0);

        person.Name = new Name
        {
            FirstName = new string('f', 10),
            LastName = new string('l', 12)
        };
        person.Age = 125;
        result = validator.Validate(person);
        Assert.False(result.Success);
        Assert.True(result.Message?.Length > 0);
        Assert.Contains("Age", result.Message);
    }

    /*
    [Fact]
    public void TestArgVerify()
    {
        string test = null;
        string testObj = null;

        Assert.Throws<ArgumentNullException>(() =>ArgumentVerify.ThrowIfNull(test, nameof(test)));
        Assert.Throws<ArgumentNullException>(() => ArgumentVerify.ThrowIfNull(testObj, nameof(testObj)));

        Assert.Throws<ArgumentNullException>(() => ArgumentVerify.ThrowIfNullOrEmpty(test, nameof(test)));
        test = string.Empty;
        Assert.Throws<ArgumentException>(() => ArgumentVerify.ThrowIfNullOrEmpty(test, nameof(test)));

        test = "foo";
        ArgumentVerify.ThrowIfNullOrEmpty(test, nameof(test));
        testObj = "bar";
        ArgumentVerify.ThrowIfNull(testObj, nameof(testObj));
    }
    */
}
