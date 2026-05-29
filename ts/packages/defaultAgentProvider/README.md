# TypeAgent Default Agent Provider

The default agent provider used by the [shell](../shell) and [CLI](../cli). It include the built in agents included in this repo and external agent provider.

## Test agents

The provider also registers a small set of agents whose only purpose is to exercise dispatcher subsystems — disabled by default in production sessions:

- [`vampire`](../agents/vampire) — deliberately collides with other agents (`play`, `addItems`, `removeItems`, `getList`, `createCalendarEvent`) to exercise the dispatcher's [action collision detection](../dispatcher/dispatcher/README.md#action-collision-detection) subsystem. Default-disabled; enable via session config when evaluating collision-resolution strategies.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
