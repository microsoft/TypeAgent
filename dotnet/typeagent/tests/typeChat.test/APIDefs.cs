// Copyright (c) Microsoft. All rights reserved.

namespace Microsoft.TypeChat.Tests;

[Comment("This is a schema for writing programs that evaluate Math expressions")]
public interface IMathAPI
{
    [Comment("Add two numbers")]
    double add(double x, double y);
    [Comment("Subtract two numbers")]
    double sub(double x, double y);
    [Comment("Multiply two numbers")]
    double mul(double x, double y);
    [Comment("Divide two numbers")]
    double div(double x, double y);
    [Comment("Negate a number")]
    double neg(double x);
    [Comment("Return pi")]
    double pi();
    [Comment("power")]
    double power(double x, double power);
    [Comment("sqrRoot")]
    double sqrRoot(double x);
    [Comment("Vectorized addition")]
    double addVector(double[] vector);
}

public interface IMathAPIAsync
{
    [Comment("Add two numbers")]
    Task<double> add(double x, double y);
    [Comment("Subtract two numbers")]
    Task<double> sub(double x, double y);
    [Comment("Multiply two numbers")]
    Task<double> mul(double x, double y);
    [Comment("Divide two numbers")]
    Task<double> div(double x, double y);
    [Comment("Negate a number")]
    Task<double> neg(double x);
    [Comment("Return pi")]
    Task<double> pi();
    [Comment("power")]
    Task<double> power(double x, double power);
    [Comment("sqrRoot")]
    Task<double> sqrRoot(double x);
    [Comment("Vectorized addition")]
    Task<double> addVector(double[] vector);
}

[Comment("This is an API for String Operations")]
public interface IStringAPI
{
    [Comment("Concat all arguments")]
    string concat(dynamic[] args);
    [Comment("Uppercase the text")]
    string uppercase(string text);
    [Comment("Lowercase text")]
    string lowercase(string text);
}

[Comment("API to get the current date and time")]
public interface ITimeAPI
{
    [Comment("Return current date and time")]
    string dateTime();
    [Comment("Return current date")]
    string date();
    [Comment("Return current time")]
    string time();
}

[Comment("API to manipulate a Person object")]
public interface IPersonApi
{
    Person makePerson(Name name, int age);
    string toJson(Person person);
    string toJsonArray(Person[] persons);
    bool isPerson(Person person, Name name, int age);
    string listBooks(AuthorPerson author);
}

public interface IAsyncService
{
    Task<string> Transform(string userText);
    Task DoWork(string userText, Name name);
    Task<Name> GetNameOf(string userText, Person person);
}
