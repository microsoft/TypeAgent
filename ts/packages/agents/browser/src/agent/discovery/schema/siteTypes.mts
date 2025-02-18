// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.
export type Ecommerce = {
    name: "Ecommerce";
    description: "A website that allows users to browse and purchase products or services.";
};

export type SocialMedia = {
    name: "Social Media";
    description: "A platform where users can interact, share content, and communicate with others.";
};

export type SearchEngine = {
    name: "Search Engine";
    description: "A website that allows users to search for information across the internet.";
};

export type News = {
    name: "News";
    description: "A website that provides the latest news, articles, and updates on various topics.";
};

export type Entertainment = {
    name: "Entertainment";
    description: "A website that offers movies, music, games, or other forms of entertainment.";
};

export type VideoStreaming = {
    name: "Video Streaming";
    description: "A website that allows users to watch and share video content online.";
};

export type Educational = {
    name: "Educational";
    description: "A platform that provides learning resources, courses, and educational materials.";
};

export type Forum = {
    name: "Forum";
    description: "An online discussion site where people can hold conversations in the form of posted messages.";
};

export type Blog = {
    name: "Blog";
    description: "A website where individuals or groups share personal insights, articles, or news.";
};

export type Government = {
    name: "Government";
    description: "An official website of a government entity providing public services and information.";
};

export type Health = {
    name: "Health";
    description: "A website that provides health-related information, medical advice, or wellness resources.";
};

export type Financial = {
    name: "Financial";
    description: "A website offering financial services, banking, investments, or cryptocurrency information.";
};

export type Business = {
    name: "Business";
    description: "A website that represents a company, providing details about its services and products.";
};

export type Sports = {
    name: "Sports";
    description: "A website focused on sports news, scores, events, and athlete information.";
};

export type Travel = {
    name: "Travel";
    description: "A website that provides travel booking services, guides, and recommendations.";
};

export type JobPortal = {
    name: "Job Portal";
    description: "A platform that connects job seekers with employers, featuring job listings and applications.";
};

export type Technology = {
    name: "Technology";
    description: "A website focused on technology news, reviews, and discussions.";
};

export type RealEstate = {
    name: "Real Estate";
    description: "A website that provides property listings, real estate market trends, and rental information.";
};

export type OnlineLearning = {
    name: "Online Learning";
    description: "A website that offers online courses, tutorials, and learning resources.";
};

export type Unknown = {
    name: "Unknown";
    description: "A website whose content does not fit in the more specific types.";
};

export type WebsiteCategory =
    | Ecommerce
    | SocialMedia
    | SearchEngine
    | News
    | Entertainment
    | VideoStreaming
    | Educational
    | Forum
    | Blog
    | Government
    | Health
    | Financial
    | Business
    | Sports
    | Travel
    | JobPortal
    | Technology
    | RealEstate
    | OnlineLearning
    | Unknown;
