# 003 — Placing in the furnace confirms a release

Status: accepted and implemented; deployment verification is recorded in PROCESS.md.

## Context

The README defines leaving as intentional. The approved B01–B05 references
show paper held over an iron furnace, with time to cancel before placement.
Several people can release the same paper, and network replies can be late.

## Options

| Option | Benefit | Cost |
| --- | --- | --- |
| Delete when Release is clicked | simplest flow | preparation becomes irreversible; contradicts the intended ritual |
| Delete only when the animation ends | apparent physical continuity | the shared paper stays available during fire; animation failures decide persistence |
| **Commit on placement, animate after confirmation** | deliberate confirmation and immediate shared truth | explicit pending, retry and degraded rendering states |

## Decision

Release prepares the paper and furnace. Cancel, Escape, an outside drop or
interrupted pointer capture before placement sends no deletion. An actual
drop inside the opening, or the accessible Place button, sends one operation
key and reading receipt. Server-confirmed destruction changes the shared
count immediately; the animation presents that fact.

HTTP and SSE confirmation are matched to both paper id and operation key.
After eight seconds without a complete HTTP reply, the visitor can return;
retrying in the background uses that same key. Returning from an unresolved
view puts its paper back visually until the server resolves it. It is not
an undo. An old reply or timer cannot ignite a later paper.

Other viewers see combustion in the paper's original position, without a
furnace. A current reader may finish under ADR 002. Snapshot reconnection
recovers status and does not replay missed fire. Safety removal clears the
paper immediately, with no combustion.

Fire asset failure and no WebGL use a drawn paper, furnace and ash, with
the same server confirmation. Reduced motion removes flicker, flames and
falling. Normal combustion takes wall-clock time even on a slow renderer;
physics step limits cannot stretch the burn into tens of seconds.

Local ash stays until the visitor leaves; the visible return button becomes
available after three seconds of ash. Escape remains an explicit exit.
Remote ash holds about five seconds and then fades.

## Consequences and verification

The database can say gone while fire is still visible: presentation and
availability have different lifetimes. The renderer stays bounded and sends
no per-frame events. The furnace uses Three.js geometry, rough iron material
and a lower ritual camera; desktop depth of field is local presentation.
Mobile geometry and side papers fit the available viewport.

`spec/ritual-ui.test.ts` covers late replies across rituals, old fallback
timers, missing effects, remote no-WebGL completion and ash hold.
`spec/burn-request.test.ts` covers hung headers, response bodies and damaged successful replies.
Existing HTTP/SSE specs cover rights, races, retries and snapshot recovery.
Browser checks supplement these with real WebGL, resizing and pointer input.
