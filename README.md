# Throwaway

A shared anonymous space for things you are ready to put down.

## What does good mean here?

Throwaway began with something I recognise: keeping a thought or feeling
bottled up for too long and wanting somewhere to leave it. I built this room
for someone carrying an unfinished conversation, regret, anger, or a thought
they cannot yet explain. They may visit once, or come back to leave another
paper and read what others have left. They can write without attaching their
name to the feeling. Good means giving that feeling a way out, and giving
someone else a chance to recognise themselves in it.

The [Paper Crumple demo](https://github.com/item-develop/paper-crumple-demo)
showed me how folding and throwing could feel physical. In Throwaway, a paper
enters the shared room closed. A visitor chooses to open it, then can press “I
saw it” after reading. That small action means someone has stopped to pay
attention. I left out rankings, comments, profiles, search and personal
histories because I want people to leave a thought without having to perform
for an audience. A return key restores a person's rights, but finding a paper
still means encountering it in the room.

I do not filter for “interesting” papers either. A short, awkward sentence may
be exactly what someone needed to put down. Safety checks address harm; they
do not grade a person's feelings. Papers appear through chance encounters.
Weiser and Brown's
[The Coming Age of Calm Technology](https://calmtech.com/papers/coming-age-calm-technology)
offers a way to describe the room: closed papers sit at the edge of attention,
and opening one brings it into focus.

The furnace is where leaving becomes real. I did not want the room to keep
accumulating anonymous messages; I wanted each paper to have an ending. Keep
leaves that choice with the writer. Release hands it to someone who has
witnessed the paper. Opening the furnace only prepares the choice: the paper
stays suspended until someone places it inside. Then it burns from the bottom
up, collapses and leaves ash. The pause and the fire give the decision weight.

Burning can also give a Release paper another life in the Gallery. The
original words are gone, and the new work stands on its own. A paper may
become an image with a short piece of music. I hope that possibility makes
people curious enough to write, release a paper and return to see what
discarded thoughts can become. For me, rebirth means a change in feeling:
sadness towards brightness, anger towards calm, powerlessness towards energy.
[Matt Stone's Goodgrowth case study](https://tympanus.net/codrops/2026/08/27/goodgrowth-boot-sequences-spinning-discs-and-the-art-of-the-portfolio/)
shaped the Gallery's orbit and central spinning disc; I used paper sleeves and
vinyl to give each work its own moment.

I can check some of these promises.
[CLAUDE.md](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/CLAUDE.md)
sets out the rules;
[witness checks](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/witness.test.ts),
[burn checks](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/burn.test.ts)
and
[real-time checks](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/realtime.test.ts)
protect what happens between visitors. But I have to judge whether it feels
like release. I compared desktop and phone views with the paper and Gallery
references, looking for a sheet that stays readable, fire that reaches ash,
and movement that keeps objects in place. I corrected a burn that ended
abruptly and a record that moved in front of its sleeve too early. For the
Gallery, I will judge whether the image and music carry one coherent emotional
turn.
[PROCESS.md](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/PROCESS.md)
records those corrections.

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
