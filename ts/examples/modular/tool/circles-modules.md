# Sketch: the circles files as modules

Status: draft by the design agent, 2026-11-18, for discussion. Nothing
has moved. Questions 1 and 2 below were decided the same day: the app
gets an external interface (its members and rules still to be agreed),
and an external blueprint is one interface plus every type its
signatures reach, rules included. It applies the module declaration agreed in `elements.md`
(Module) to the circles design files, to see where it strains.

## A possible split

| Module (directory) | External interface (its `index.ts`) | Internal design files |
|---|---|---|
| `/` (the app, outermost) | none yet: see question 1 | `scenarios.ts`, and the modules below |
| `geometry/` | `RectangleOps` | `geometry.ts` |
| `color/` | `Color` (a type with rules) | `color.ts` |
| `events/` | `EventEmitter` | `events.ts` |
| `frames/` | `FrameScheduler` | `frames.ts` |
| `shapes/` | `ShapeMessageProcessor` | `shape.ts`, `dataModel.ts`, `shapeModel.ts` |
| `view/` | `ShapeView` | `view.ts`, `shapeView.ts` |
| `layout/` | `EventDistributor` | `layout.ts` |
| `platform/` | `DrawingContext`, `DomDocument` | `canvas.ts`, `dom.ts` |

How each module would import the others (from the current imports):
`shapes` imports `geometry`, `color` and `events`; `view` imports
`shapes`, `frames`, `geometry` and `events`; `layout` imports
`geometry`.

## Where it strains

1. **The app has no external interface.** Its scenarios treat it as a
   black box, but in the terms of `scenarios.ts`' own types (`Action`,
   `Step`, `CirclesSettings`) played by a driver, not through an
   interface. If every module's external blueprint is one interface, the
   outermost one needs one too: something like an interface that takes
   the user's actions and exposes what is drawn.

2. **"The types its signatures need" pulls in interfaces with rules.**
   `ShapeMessageProcessor.model` is a `ShapeCollection`, and
   `logOperations` an `EventEmitter`; `ShapeView` mentions
   `ShapeCollection` and the view's interfaces. `ShapeCollection` has
   many rules. So the outside sees more than one interface's rules
   whatever we call it. One way to say it: a module's external blueprint
   is one interface plus every type its members' signatures reach,
   transitively; those defined in the module are part of its face, rules
   included, and the rest come from modules it imports.

3. **Several interfaces in one file, split across modules.**
   `geometry.ts` holds `Point`, `Rectangle` and `Viewport` with
   `RectangleOps`; `shape.ts` holds `ShapeLocator`, which only the
   collection's implementations use. `ShapeLocator` and
   `ShapeCollectionWriter` would be internal to `shapes`; implementations
   get them through the module's wiring, which is outside the design.

4. **Platform modules export more than one interface.** With question 2's
   reading, `platform/` could export `DomDocument` and reach the other
   DOM interfaces through its signatures, but `DrawingContext` is
   separate. Either platform declarations get one module each, or they
   are an exception.
