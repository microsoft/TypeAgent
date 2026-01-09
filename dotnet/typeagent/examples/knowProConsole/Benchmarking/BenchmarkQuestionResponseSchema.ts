// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type Categories =

    // Find a where something was discussed
    | "retrieval"

    // Find when something was discussed
    | "scope"

    // Role attribution (i.e. who said what to whom)
    | "attribution"

    // Questions about specific topics or structure
    | "segmentation"

    // Questions about specific objects/things
    | "entity"

    // Conversation summary/highlights
    | "summary"

    | "sentiment"

    | "outcomes"

    | "intent"

    // create a new cateogry if the above categories do not suffice
    | string;

export type Question = {
    // A question about the transcript
    question: string;

    // The category of this question: i.e. sentiment, metadata, fact, opinion, retreival
    category: Categories;

    // A concise answer to the question
    answer: string;
}

export type QuestionGeneratorResponse = {
    questions: Question[];
}
