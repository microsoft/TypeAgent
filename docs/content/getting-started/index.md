---
layout: docs
title: Getting Started with TypeAgent
---


This guide will help you set up and start using TypeAgent in your projects.

## Prerequisites

Before you begin, ensure you have the following:

- Node.js (v14 or later)
- npm or yarn
- TypeScript knowledge
- An OpenAI API key or Azure OpenAI Service

## Installation

Install TypeAgent using npm:

```bash
npm install @typeagent/core
```

Or using yarn:

```bash
yarn add @typeagent/core
```

## Configuration

TypeAgent requires configuration for your language model. Create a `.env` file with the following variables:

```
OPENAI_API_KEY=your_api_key_here
OPENAI_MODEL=gpt-4
```

Or for Azure OpenAI:

```
AZURE_OPENAI_API_KEY=your_api_key_here
AZURE_OPENAI_ENDPOINT=your_endpoint_here
AZURE_OPENAI_DEPLOYMENT=your_deployment_name
```

## Basic Usage

Here's a simple example of how to use TypeAgent:

```typescript
import { Agent } from '@typeagent/core';

// Initialize your agent
const agent = new Agent({
  // Configuration options
});

// Handle user input
agent.processRequest('Create a new task for tomorrow');
```

## Next Steps

Now that you have TypeAgent installed, check out the [Configuration](/getting-started/configuration/) guide to learn how to customize your agent.
