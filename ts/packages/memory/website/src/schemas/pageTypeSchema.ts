// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Available page types for content classification
 * These represent the most common types of web content for organizing and searching
 */
export type PageType =
    /** Step-by-step instructional content with learning objectives */
    | "tutorial"

    /** Official documentation, API docs, technical specifications */
    | "documentation"

    /** Informational or opinion pieces, news articles, blog posts */
    | "article"

    /** Comprehensive how-to content, best practices, methodologies */
    | "guide"

    /** Quick reference materials, cheat sheets, lookup tables */
    | "reference"

    /** Personal or company blog posts, informal articles */
    | "blog_post"

    /** News articles, press releases, current events */
    | "news"

    /** E-commerce pages, product descriptions, sales pages */
    | "product_page"

    /** Marketing pages, company homepages, service descriptions */
    | "landing_page"

    /** Interactive tools, demos, simulators, playgrounds */
    | "interactive_demo"

    /** Code snippets, programming examples, sample implementations */
    | "code_example"

    /** API documentation, technical reference for developers */
    | "api_docs"

    /** Fallback category for content that doesn't fit other types */
    | "other";
