## TypeAgent Shell

### Definitions

- _personal assistant (PA)_: a conversational interface for an application. The interface may include graphical elements, but conversation provides the superstructure of the interface.
- _session_: a sequence of interactions with a PA.
- _session state_: the history of customer interactions, including information retrived on behalf of customer requests and information extracted from customer requests.
- _type agent_: a plugin component for the personal assistant that using TypeChat Schema to interpret user requests and handle actions
- _agent_: an AI component used by a _type agent_
- _multi-agent typeagent_: a _type agent_ that uses networks of agents to respond to user requests
- _multi-agent configuration_: an organization of agents, such as pipeline, chain-of-prompts, fan-out, etc.

### Why TypeAgent Shell?

As conversational interfaces proliferate on computing devices, some will be delivered by cloud services, others will be local. Many will include a speech capability. The customer will switch manually between typeagents. For example, a customer working with data visualization will need to switch to the music typeagent to change songs, or the communications typeagent to check Teams or e-mail. Any caching used to reduce interaction latency and cost will be isolated to each typeagent.

TypeAgent shell improves this situation by providing a central resource for caching, use of local models such as speech recognition, and settings for interaction hardware such as microphones. In addition, typeagent shell can find the best typeagent for a given customer request without requiring the customer to manually select a typeagent.

### How it works

TypeAgents register with the TypeAgent Shell. This registration includes cache entries as well as information to enable the shell to match customer input to potentially relevant typeagents. Most of the time, a customer request matches a cached interaction pattern, enabling the shell to route the request to the matching typeagent with near zero cost and latency. On a cache miss, the shell uses its set of dispatch heuristics to route the request to a typeagent, which either implements the the user request or yields the request back to the typeagent shell. In this case, the shell continues to iterate through the typeagent candidates most likely to implement the request. In the event that no typeagent can implement the request, the shell works with the customer to modify the request. The customer always has the option of bypassing the shell and inputting a request directly to a specific typeagent. In this case, the typeagent will may either deal with a non-implementable request or pass the request to the typeagent shell.
