# Behavioral specification

How the circles app's behavior is specified, what has been decided, and what
is still open. This is phase 1 work, done with the human (`method.md`).
`STATE.md` says where everything else stands.

## The orientation (decided 2026-11-10)

- **Specify relationships, not controls.** What must be right are two
  relationships: controller to model, and model to view. Controls are
  defined only by their effect on the core visual, the view of the
  drawing. The controller changes the model, the model changes the view,
  and the scenarios check the result.
- **Leave the means of control to each platform.** Nothing says a control
  is a radio button, a slider or a button, or where it goes. Copying look
  and feel between platforms, for example from web to mobile, is a
  separate step, done from images or by interpretation.
- **How the controller changes the model is left to the implementation.**
  The scenarios constrain it from outside.
- **No controller interface.** Behavior lives in scenarios, not in rules
  on an interface. The only rules that bind a controller are the two in
  the header of `frames.ts`: `frames.complete` (an input event's update to
  the model finishes before its handler returns) and
  `frames.fraction-of-frame` (the time budget).
- **Prefer case tables to large random runs** when the cases can be
  enumerated, as in `eventDistributor.contract.ts`. Keep random runs small
  and for what can't be listed, such as `Scenario.random`.

## What was removed, and why

Round 5 had `chrome.ts` (the toolbar's model, with an exact control table
and layout), `ui.ts` (a semantic tree and a renderer) and `app.ts` (the
wiring). They specified the means of control, so they were removed with
their contracts, kits, tests, 40 adversaries and tasks 13 to 15. Behaviors
they specified that the scenarios no longer check:

- status text ("No circles", "1 circle", "n circles");
- which controls are enabled (color and radius disabled in erase mode;
  Clear disabled when the drawing is empty);
- which radio is selected;
- radius snapping to the slider's steps and range (a platform slider does
  this; scenarios choose only on-step values).

These were dropped because none of them shows in the drawing. Any of them
could come back as a scenario if it is restated as an effect on the core
visual.

## How behavior is specified now

| File | Role |
|---|---|
| `scenarios.ts` | The behavior: `Action` (tap, color, radius, mode, clear), `Step` (an action, or "painted at p is a color"), `CirclesSettings` and `demoSettings` (palette, radius range, initial radius, drawing size), and the scenarios themselves |
| `scenario.contract.ts` | `Driver`, the only thing a platform writes for these tests (`act`, `painted`, `dispose`). Runs each scenario under its ID, `frames.complete` on random actions, and `Scenario.random` against a reference |
| `driver.ts` | The test platform's driver, for my app and a peer's, with a sequencer between them. Its controls are methods (`TestCirclesApp`), and a tap is an event given to an `EventDistributor` for the window, at the drawing's offset (48 units down, where a platform would put its controls). It is also the message infrastructure: it owns the processor, gives the controller the model's read side and a `LocalSend`, sequences each sent operation and returns its acknowledgment. After each action it processes what was sent, runs the frames anything asks for, processes again, and throws if the model changed after the first processing (`frames.complete`) |
| `circleskit.ts` | The reference controller: registers with the distributor, with the view's surface as its target, and converts taps from window to view coordinates (canonical too, since ShapeView's viewport is the identity). It sends an add to draw, finds the top circle at the point with `atPoint` and sends a remove to erase, and sends a clear |
| `scenariokit.ts` | The reference assembly, every part a reference. `kitDriver({ part: … })` swaps one part |
| `adversaries/_circles.ts` | The reference controller with switchable bugs, for scenario adversaries |

Scenario points are in the drawing's coordinates, at least a unit from any
circle's edge, so that antialiasing can't change the answer.

The scenarios, as of 2026-11-10: `starts`, `draw-one`, `color-and-radius`,
`largest-radius`, `settings-kept-through-erase`, `erase-top-of-overlap`,
`erase-misses`, `clear`, `clear-in-erase-mode` and
`draw-after-erase-is-on-top`, plus `Scenario.random` and `frames.complete`.

## Adding a behavior

1. Write the scenario in `scenarios.ts`: actions, then the colors expected
   at chosen points. Its ID is `Scenario.<slug>`.
2. Run `node adversaries/helpers.check.ts`. The reference app must pass it,
   or the scenario is wrong.
3. Add a bug to `adversaries/_circles.ts` (or to another part's helper,
   such as `_view.ts`) that the scenario must catch, and an adversary
   `adversaries/Scenario.<slug>--<bug>.adversary.ts`:
   `scenarioContract(() => kitDriver({ app: makeTestCircles("<bug>") }), () => kitDriver())`.
4. Check it on seeds 1 to 3: `FC_SEED=n npm run adversaries -- Scenario`.
   If it escapes, make the scenario hit the boundary directly, as
   `largest-radius` does for radii the random run rarely reaches.
5. If the behavior needs a new kind of action, add it to `Action`, to
   `driver.ts`'s `act`, to `TestCirclesApp` and the reference controller,
   and to the action generator in `scenario.contract.ts`.

## Changes after the review of 2026-11-13

- `Scenario.random` compares only grid points a unit or more from every
  edge of the reference's circles (`Driver.circles`), as the
  scenarios' own points are, so a platform's antialiasing can't fail it.
- `frames.fraction-of-frame` budgets one input event's operations with
  10,000 shapes, and `bench.ts` measures the circles app's taps (task 10).
  The ink app is deferred, so the budget no longer names strokes.
- `Scenario.tap-outside`: a tap above the drawing, where the controls are,
  draws nothing.
- **A collaborator.** Every driver runs two apps on one drawing, mine and
  a peer's, and sequences what each sends. A step can say `by: "peer"`, an
  expectation `on: "peer"`, and network steps make operations pending and
  choose their order: `hold`, `release` (one app's held operations, or the
  first `count` of them) and `sync` (`NetStep` in `scenarios.ts`). Seven
  scenarios use them: `peer-draw-shows`, `remote-under-pending`,
  `concurrent-overlap-converges`, `clear-keeps-unseen`,
  `clear-erases-own-pending`, `pending-stack-in-order` and
  `clear-removes-seen`. `Scenario.random` includes the peer's actions and
  network steps, ends with a sync, and checks that both drawings are then
  the same (`MessageProcessor.converges`). Their adversaries are processor
  bugs seen through the app (`kitDriver({ processor })`).
- **An in-memory server is deferred.** `driver.ts`'s sequencer stands in
  for one; a server like Fluid's tinylicious waits for the collaboration
  protocol.

## Open questions

- **Reading pixels on each platform.** `painted` assumes a platform's
  driver can read what the view's surface shows at a point. The test
  platform does it through `RecordingContext`. A browser driver could
  read the canvas; mobile drivers need their own way. The alternative is
  to check the model's circles, which tests the model instead of the core
  visual.
- **The web app.** No phase 2 task yet. It needs a platform driver that
  does the actions with real widgets and hosts a peer (a test-platform app
  in the same process will do), the DOM members those widgets use
  added to `dom.ts`, and a recording document for them (the old
  `domkit.ts` went with the web renderer). This waits for the discussion
  of the platform subsets.
- **Viewport gestures.** Pinch, pan and rotate are a controller's now: it
  sets the view's viewport. No scenario covers them, and ShapeView
  supports only the identity viewport (`View.viewport.set-redraws` and
  `set-emits` are `@deferred`).
- **Coordinates from event to model.** The reference controller subtracts
  the surface's top left and treats the result as canonical, which holds
  only for the identity viewport. With other viewports it must apply the
  viewport's inverse (`Viewport` in `geometry.ts`); nothing tests that yet.
- **Whether any behavior belongs in rules.** Everything is in scenarios.
  If a behavior should hold for every app built from these parts, not only
  the circles app, it would need an interface to carry it.
