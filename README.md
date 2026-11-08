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

Robin Sloan's [family messaging app](https://www.robinsloan.com/notes/home-cooked-app/)
gave me a way to think about scale. Throwaway is open to strangers, but a
visit can be worthwhile even if all you do is read one paper. I left out
rankings, comments, public profiles and search so there is room for that
kind of visit. An optional account lets you find your own papers and see
what they became in a private view. With no audience, it gives no reason
to perform.

I want visitors to understand who can burn their paper before they choose
how to leave it. The room is available in English and Simplified Chinese,
and each paper stays in the words its writer chose.

In [Popcannibal's Kind Words](https://popcannibal.itch.io/kindwords),
strangers answer anonymous requests with letters of comfort or advice.
I wanted a reader to be able to show they paid attention without asking
the writer to start a conversation. A paper arrives closed. After opening
and reading it, the visitor can simply press “I saw it”.

I do not filter for “interesting” papers either. A short, awkward sentence may
be exactly what someone needed to put down. Safety checks address harm; they
do not grade a person's feelings. Papers appear through chance encounters.
Weiser and Brown's
[The Coming Age of Calm Technology](https://calmtech.com/papers/coming-age-calm-technology)
offers a way to describe the room: closed papers sit at the edge of attention,
and opening one brings it into focus.

The [Paper Crumple demo](https://github.com/item-develop/paper-crumple-demo)
showed me how folding and throwing could feel physical. I wanted that same
weight at the end. Keep leaves the decision to burn with the writer.
Release hands it to someone who has witnessed the paper. The paper hangs
above the furnace until someone places it inside, then burns from the bottom
up and collapses into ash.

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
without signing up. This browser remembers you as an anonymous visitor.
If you have an account, use **Sign in** at the top right to pick up your
papers on another browser. Choose **中 / EN** in the header to change the
interface language.

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
return to the room. If **Explore the space** is available, use it to bring
another selection of papers into view.

### Let a paper go

You can destroy your own Keep paper. To destroy a Release paper, first
open it and choose **I saw it**, including when you wrote it yourself.

In the reading sheet, **Release it** brings up the furnace. Drag the
floating paper into its opening, or choose **Place in furnace**. You can
cancel before placement. Once the server confirms, the paper is gone from
the shared collection and the burn plays. In another room, the paper
burns in place if it is in view. Someone who already has it open can
finish reading it.

Let the paper burn down to ash, then choose **Back to the space**. The
return button becomes available after three seconds of ash.

### Share the room

Open the same room on two devices, in two browser profiles, or in a regular
window and a private window. Leave both sessions as guests so you can try
it as two different visitors. Two ordinary tabs in the same profile share
one visitor. Put the two rooms side by side, call them A and B, and keep
both open without refreshing. The number next to **Throwaway** counts all
papers still in the room. Each visitor sees their own selection and arrangement.

1. **A leaves a paper.** Choose **Leave something here** and write a short
   test note, such as “I am letting go of a busy morning.” Select
   **Release it**, tick **I understand**, then choose **Crumple & throw**.
   Once the paper passes its check and is saved, B's total goes up by one
   and the new paper arrives in B's room within about a second. Open it
   in B and check the words.
2. **B witnesses it.** With the same paper also open in A, choose **I saw it**
   in B. B's button changes to **Witnessed**. A's sheet shows
   “1 person has witnessed this.” without a refresh.
3. **B burns the paper.** To watch from A, close its reading sheet and
   check that the same paper is visible in A's room. In B, choose
   **Release it** on the open sheet and drag the paper into the furnace
   or choose **Place in furnace**. Once the server confirms the burn,
   A's paper count drops by one within about a second, without a reload.

   - **The paper is on A's screen.** As it burns in B's furnace, the same
     paper automatically catches fire where it lies on A's screen. The
     furnace appears only for B.
   - **The paper is outside A's view.** A smaller screen or browser window
     can show fewer papers. If A's room is showing a selection that
     leaves this paper out, A sees the count drop without seeing it burn.
   - **A is still reading the paper.** A can finish reading it. Once the
     sheet closes, the paper is gone.

   In B, wait for the ash to settle and choose **Back to the space**.

If two people try to let go of the same paper at once, the first confirmed
burn removes it and the shared total drops once.

To check what survives a return visit, refresh A after the paper is saved
and before B burns it. The total still includes that paper, and the room
may show a different selection. Refresh again after the burn to see the
updated total. When a dropped connection returns, the room catches up
without replaying any burns you missed. Saved papers stay
through restarts and deployments until they are burned or removed.

### Keep an account (optional)

Choose **Sign in** at the top right, then **Create an account** with a
username and a password. You are also invited after your first Keep and
your third paper; **Not now** closes it. Creating an account keeps
everything you have already left and your rights to it. There is no email
and no password recovery yet, so keep your password somewhere safe.

Once signed in, your username replaces **Sign in**. Choose it to see your
papers still in the space, in two groups: **Kept by you**, which only you
can let go, and **Released**, which are in readers' hands. Open any of them
to read it again. Below them, **What they became** shows the Gallery
records your released papers left, which you can play. Only you see this. Everyone else still meets your papers and
records anonymously. Signing in on another browser brings the same papers
and rights there. **Sign out** returns this browser to a new guest.

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
Visitor identities, cookies, usernames and passwords stay out of those
requests. An account stores a username and a salted, peppered scrypt hash of
its password, never the password itself, and no email.
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
  [record music](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/006-browser-synthesised-record-music.md),
  [anonymous identity](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/007-people-and-permissions.md),
  [emotional reversal](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/008-rebirth-reversal.md)
  and [optional accounts](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/009-optional-accounts.md)
  explain how the experience is implemented.
