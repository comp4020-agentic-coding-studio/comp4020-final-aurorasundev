# Throwaway

A shared anonymous space for things you are ready to put down.

## What does good mean here?

Throwaway gives the act of letting go a physical form. I want a thought to
have somewhere to go: onto a sheet, into a crumpled ball, across a room,
and eventually into a fire. Good means giving people control over what
they leave, time to attend to a stranger's thought, and a deliberate ending
to a paper. The weight of those small actions is the point of the project.

The [Paper Crumple demo](https://github.com/item-develop/paper-crumple-demo)
gave that idea a concrete starting point. Its folding and falling made
paper feel like something a person could handle. I adapted that physical
interaction into a shared room: words stay folded away until someone
chooses to open a sheet. Its creased edges should suggest handling while
the centre stays clear enough to read.

Reading is an encounter. “I saw it” makes witnessing an intentional act:
someone has paused with what another person left. Its count belongs inside
the opened paper, where it can mean acknowledgement. I left out rankings,
comments and profiles because they would encourage performance and
comparison. I also chose to omit search and personal histories. Even with
a return key, a person finds their papers by encountering them again in
the shared space. Leaving something here involves letting it out of view.

Weiser and Brown's [The Coming Age of Calm Technology](https://calmtech.com/papers/coming-age-calm-technology)
offers a useful lens for this choice: attention can move between centre
and periphery. The room suggests other people's presence through closed
papers; opening one brings its content into focus. The Gallery invites
more concentrated attention through movement and deliberate listening.

Keep and Release make control visible. Keep preserves the author's right
to decide when a paper disappears. Release hands that decision to readers
who witness it. The furnace gives the choice time and consequence: the
paper waits above the opening until someone places it inside. Fire,
collapse and ash carry it through to an ending that others can see.

My revised direction for the Gallery is rebirth. Burning ends the original
note and opens a contrasting emotional direction: sadness towards brightness,
anger towards calm, powerlessness towards energy. Ambiguous notes can become
mysterious works. I want image and music to carry that transformation together,
using each note as the starting material for a new creation.
[Matt Stone's Goodgrowth case study](https://tympanus.net/codrops/2026/08/27/goodgrowth-boot-sequences-spinning-discs-and-the-art-of-the-portfolio/)
provided a reference for orbital browsing and a central rotating disc.
I translated it into paper sleeves and dark vinyl, giving each work a
moment of focus. Visitors can interpret the resulting colour, material
and sound for themselves.

The room's rules are recorded in [CLAUDE.md](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/CLAUDE.md).
The server enforces authorship rights on Keep papers and requires witnessing
before a reader burns a Release paper. [Witness checks](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/witness.test.ts)
verify that opening adds nothing and each other reader counts once.
[Burn checks](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/burn.test.ts)
protect a single destruction across simultaneous actions and retries;
[real-time checks](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/realtime.test.ts)
verify delivery to connected visitors.

The feel of those actions needs judgement. I compared browser views and
transition stages with the paper and Gallery references at desktop and
phone sizes. My criteria were a readable sheet, a burn that visibly
progresses to ash, and movement that preserves the objects' spatial
relationships. I rejected an abrupt disappearance and specified that the
disc must slide completely clear of its sleeve before changing its
front-to-back position. For rebirth, I will judge whether image and music
share the chosen emotional contrast and feel like one coherent new work. [PROCESS.md](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/PROCESS.md)
links those corrections to the implementation record.

## How to use Throwaway

### Enter the space

[Open the room](https://comp4020-final-aurorasundev.fly.dev/). You can start
without signing up. A cookie gives this browser an anonymous identity.
A separate browser profile or private window is another visitor.

### Leave a paper

Choose **Leave something here**. Use **Type** for up to 2,000 characters,
or **Draw** to make marks on the sheet. You can use both on the same paper;
switching tabs keeps your draft. The drawing tools include a pen, eraser,
undo and clear.

Choose how to leave it:

- **Keep it:** you retain the right to destroy this paper when you encounter
  it again.
- **Release it:** anyone who opens and witnesses it can destroy it. When it
  burns, its content can shape a public Gallery record.

Read and tick **I understand**, then choose **Crumple & throw**. Your paper
enters the shared room after it is checked and saved. Its words, drawing
and mode are fixed once thrown. A failed submission leaves the open draft
available to revise or retry.

### Encounter and witness

Click or tap a paper to open it. You can also reach the paper controls with
Tab and open them with the keyboard. Read its words and drawing, then
choose **I saw it** to witness it. Each other reader adds one witness,
however many times they return. You can acknowledge your own paper without
adding to its witness count. Close the sheet with the cross or Escape to
return to the room.

### Let a paper go

You can destroy your own Keep paper. To destroy a Release paper, first
open it and choose **I saw it**, including when you wrote it yourself.

In the reading sheet, **Release it** brings up the furnace. Drag the
floating paper into its opening, or choose **Place in furnace**. You can
cancel before placement. Once the server confirms, the paper is gone from
the shared collection and the burn plays. Other visitors see it burn where
it was lying. Someone already reading it can finish their reading.

Let the paper burn down to ash, then choose **Back to the space**. The
return button becomes available after three seconds of ash.

### Keep your return key

After your first Keep, save the return key offered to you; it is shown
once. Use **Return key** in another browser to restore your identity and
rights. You still encounter papers through the shared room: the key
provides no list or personal history. Clearing cookies starts a new visitor
unless you restore your saved key.

### Visit the Gallery and listen

Choose **Gallery**, or [enter the exhibition](https://comp4020-final-aurorasundev.fly.dev/gallery/).
Scroll, swipe or choose the entrance hint to enter. Turn the collection
with the wheel or by dragging, or use its arrow buttons and keyboard
arrows. Narrow screens show a vertical orbit. Select a work to open its
record; **Back to the Gallery** returns to browsing. The Gallery wordmark
returns to the entrance, and **Back to the space** returns to the room.

Choose **Listen** on a record with sound. Its 24-second instrumental is
performed in your browser; you control playback, pause and volume. Sound
starts when you choose to listen and stops when you leave the record.
Image-only records say when they have no sound. “New to you” and “Not heard
yet” describe activity remembered in this browser.

Images appear after a Release paper burns and processing completes. Some
released papers leave no record. Keep papers leave no Gallery record.
The exhibition presents the resulting works without a link to their source.

### Share the room

Open Throwaway in two separate browser profiles to visit as two people.
Saving or burning a paper changes the other open room within about a
second, without a reload. Each room shows a selection of the shared
collection, with its own paper positions. Saved papers remain across
visits, restarts and redeployments until they are burned or removed.

## Safety checks and reporting

Papers are public once thrown. OpenAI checks submitted words and drawings
before publication. Ordinary distress, regret, anger and accounts of harm
belong here. Threats, targeted abuse, private identifying information,
harmful instructions, sexual exploitation and scams are refused. Leave
private details out of your paper.

When a Release paper burns, its words and drawing are cleared from the
stored paper. They are sent once from memory to OpenAI to extract creative
directions. Those directions shape the inspected image and the browser's
musical score. The Gallery stores the directions and resulting work.

Use **Report this paper** or **Report this record** from an opened item.
Paper reports receive automatic or operator review; Gallery reports go to
an operator. Reporting alone leaves the item available while it is reviewed.
Paper text removed for safety disappears from open readings immediately.

OpenAI receives the content needed for these checks and creative processing.
Visitor identities, cookies and return keys stay out of those requests.
Report notes are kept for 30 days. Processing and review details are in the
[moderation decision](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/004-configured-safety-review.md)
and [Gallery decision](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/005-release-keepsakes.md).

## Implementation references

- [Paper Crumple demo](https://github.com/item-develop/paper-crumple-demo),
  by nagasawa (ITEM Inc.), provides the folding animation and paper physics,
  reused under MIT. [Third-party notices](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/THIRD_PARTY_NOTICES.md)
  record the adaptations.
- Decisions on [real-time updates](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/001-sse-snapshots.md),
  [finishing a reading](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/002-active-reader-final-read.md),
  [furnace placement](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/003-furnace-confirmation.md),
  [record music](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/006-browser-synthesised-record-music.md)
  and [anonymous identity](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/007-people-and-permissions.md)
  explain how the experience is implemented.
