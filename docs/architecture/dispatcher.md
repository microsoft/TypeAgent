# TypeAgent Dispatcher Architecture

## Overview

TypeAgent [Dispatcher](../../ts/packages/dispatcher) is **sample code** and the core component that explores how to build a **personal agent** implementation with TypeChat. The component's purpose is to understand user requests and translate it into actions and dispatch them to the appropriate TypeAgent to execute.

## Design Goals

Here are the design goals of the dispatcher:

- Dispatcher processes user requests and use LLM to translate them into actions based on schemas provided by application agents. It automatically finds and switches between different agents to provide a seamless experience in a extensible and scalable way. It aids the user to clarify and complete missing details needed to perform the actions.
- Dispatcher component can be hosted by different client front ends. [TypeAgent Shell](../../ts/packages/shell) and [TypeAgent CLI](../../ts/packages/cli) are two example of clients built using dispatcher to show case the **personal agent** experience.
- Dispatcher has extensible [application agents](../../ts/packages/agentSdk/README.md) architecture that allow new agents to be developed and plugin to the **personal agent** experience, scaling up to thousands and more actions.
- Dispatcher leverage an [agent cache](../../ts/packages/cache/README.md) to lower latency and cost.
- Dispatcher memorize conversation history by integrating with [knowledge processor](./knowPro.md) to store past memory and recall for future use.

The current **sample** implementation of TypeAgent [Dispatcher](../../ts/packages/dispatcher) is a work in progress toward these goal and have explored most of the pieces described here.

## Definitions

- _personal agent (PA)_: a conversational interface for an application. The interface may include graphical elements, but conversation provides the superstructure of the interface.
- _session_: a sequence of interactions with a PA.
- _session state_: the history of customer interactions, including information retrieved on behalf of customer requests and information extracted from customer requests.
- _type agent_: a plugin component for the personal assistant that using TypeChat Schema to interpret user requests and handle actions
- _agent_: an AI component used by a _type agent_
- _multi-agent typeagent_: a _type agent_ that uses networks of agents to respond to user requests
- _multi-agent configuration_: an organization of agents, such as pipeline, chain-of-prompts, fan-out, etc.

## Why TypeAgent Dispatcher?

As conversational interfaces proliferate on computing devices, some will be delivered by cloud services, others will be local. Many will include a speech capability. The customer will switch manually between typeagents. For example, a customer working with data visualization will need to switch to the music typeagent to change songs, or the communications typeagent to check Teams or e-mail. Any caching used to reduce interaction latency and cost will be isolated to each typeagent.

TypeAgent dispatcher improves this situation by providing a central resource for caching, use of local models such as speech recognition, and settings for interaction hardware such as microphones. In addition, typeagent dispatcher can find the best typeagent for a given customer request without requiring the customer to manually select a typeagent.

## How it works

TypeAgents register with the TypeAgent Dispatcher. This registration includes cache entries as well as information to enable the dispatcher to match customer input to potentially relevant typeagents. Most of the time, a customer request matches a cached interaction pattern, enabling the dispatcher to route the request to the matching typeagent with near zero cost and latency. On a cache miss, the dispatcher uses its set of dispatch heuristics to route the request to a typeagent, which either implements the the user request or yields the request back to the typeagent dispatcher. In this case, the dispatcher continues to iterate through the typeagent candidates most likely to implement the request. In the event that no typeagent can implement the request, the dispatcher works with the customer to modify the request. The customer always has the option of bypassing the dispatcher and inputting a request directly to a specific typeagent. In this case, the typeagent will may either deal with a non-implementable request or pass the request to the typeagent dispatcher.
