# Status — agent `@`-commands → NL actions

Tracks progress against [PLAN.md](./PLAN.md). Update the checkboxes and notes as
each phase lands.

## Phase checklist

- [ ] **Phase 1 — Pilot: localPlayer (linking only)** — add 15 `readonly action`
      links, build, regenerate catalog (without-action −15), enable + smoke-test.
- [ ] **Phase 2 — Link remaining matches** — powershell (4), osNotifications (2),
      selfhelp (1), browser page-ops (7); verify `ask`→`searchWebMemories`.
- [ ] **Phase 3 — New auth actions** — calendarLogin/Logout, emailLogin/Logout,
      spotifyLogin/Logout (schema + grammar + handler + link + tests).
- [ ] **Phase 4 — New action: email `index`** (`indexInbox`).
- [ ] **Phase 5 — New browser config / search-provider actions** (config
      sub-schema; collision-aware; last).

## Per-command tracking

### Linking (existing actions)

| Command                  | Action                             | Done |
| ------------------------ | ---------------------------------- | :--: |
| localPlayer play         | playFile                           |  ☐   |
| localPlayer pause        | pause                              |  ☐   |
| localPlayer resume       | resume                             |  ☐   |
| localPlayer stop         | stop                               |  ☐   |
| localPlayer next         | next                               |  ☐   |
| localPlayer prev         | previous                           |  ☐   |
| localPlayer shuffle      | shuffle                            |  ☐   |
| localPlayer status       | status                             |  ☐   |
| localPlayer list         | listFiles                          |  ☐   |
| localPlayer queue        | showQueue                          |  ☐   |
| localPlayer clear        | clearQueue                         |  ☐   |
| localPlayer mute         | mute                               |  ☐   |
| localPlayer volume       | setVolume                          |  ☐   |
| localPlayer setfolder    | setMusicFolder                     |  ☐   |
| localPlayer folder       | showMusicFolder                    |  ☐   |
| powershell list          | listPowerShellFlows                |  ☐   |
| powershell run           | executePowerShellFlow              |  ☐   |
| powershell delete        | deletePowerShellFlow               |  ☐   |
| powershell import        | importPowerShellFlow               |  ☐   |
| osNotifications sync     | syncOsNotifications                |  ☐   |
| osNotifications test     | testOsNotification                 |  ☐   |
| selfhelp ask             | answerTypeAgentQuestion            |  ☐   |
| browser open             | openWebPage                        |  ☐   |
| browser close            | closeWebPage                       |  ☐   |
| browser extractKnowledge | extractPageKnowledge               |  ☐   |
| browser learn            | startGoalDrivenTask                |  ☐   |
| browser actions match    | detectPageActions                  |  ☐   |
| browser actions infer    | inferActions                       |  ☐   |
| browser actions record   | createWebFlowFromRecording         |  ☐   |
| browser ask              | searchWebMemories (verify/partial) |  ☐   |

### New actions

| Command                                        | New action                     | Done |
| ---------------------------------------------- | ------------------------------ | :--: |
| email index                                    | indexInbox                     |  ☐   |
| calendar login / logout                        | calendarLogin / calendarLogout |  ☐   |
| email login / logout                           | emailLogin / emailLogout       |  ☐   |
| player spotify login / logout                  | spotifyLogin / spotifyLogout   |  ☐   |
| browser external on/off                        | (config sub-schema)            |  ☐   |
| browser resolver history/keyword/list          | (config sub-schema)            |  ☐   |
| browser lookup mode/status                     | (config sub-schema)            |  ☐   |
| browser search add/import/list/remove/set/show | (config sub-schema)            |  ☐   |

### Excluded (for now)

`google-auth` (calendar, email); dispatcher `request`/`match`/`translate`/`reason`/`reasoning`/`explain`;
`powershell show`; browser `auto launch hidden|standalone`, `auto close`, `actions stop recording`.
