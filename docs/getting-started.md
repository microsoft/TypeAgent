---
title: Getting Started
---

# Getting Started with TypeAgent

TypeAgent is a TypeScript library for building personal agents with natural language interfaces. This guide will help you get started with TypeAgent.

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

## Creating Your First Agent

To create a custom agent, you'll need to define a schema that represents the actions your agent can take:

```typescript
// taskSchema.ts
export interface TaskAction {
  action: "createTask" | "completeTask" | "listTasks";
  taskName?: string;
  taskId?: string;
}
```

Then, use this schema with your agent:

```typescript
import { createTypeAgentFromSchema } from '@typeagent/core';
import { TaskAction } from './taskSchema';

const agent = createTypeAgentFromSchema<TaskAction>({
  schema: TaskActionSchema,
  actions: {
    createTask: async (params) => {
      // Implementation to create a task
      return `Created task: ${params.taskName}`;
    },
    completeTask: async (params) => {
      // Implementation to complete a task
      return `Completed task with ID: ${params.taskId}`;
    },
    listTasks: async () => {
      // Implementation to list tasks
      return "Here are your tasks: ...";
    }
  }
});

// Process a user request
agent.processRequest("Create a new task called 'Finish documentation'");
```

## Next Steps

Check out the [API Reference](/api-reference) for more details on TypeAgent's capabilities, or explore the [Examples](/examples) section to see more complex agent implementations.