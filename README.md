# Throwaway

A shared anonymous space for things you are ready to put down.

## What does good mean here?

Leaving something behind should feel intentional. Papers are encountered
through a shared space, and their words remain hidden until someone chooses
to open them.

A paper cannot be edited after it is thrown. There is no personal archive,
search, ranking, or public profile.

## What works now?

You can write a paper, choose to keep it or release it, and throw it into
the space. Visitors already there see it land without reloading. Opening a
paper shows its words; choosing "I saw it" witnesses it, once per visitor.
A kept paper can be let go only by the person who left it; a released paper
by anyone who has witnessed it. If a paper is let go while you are reading
it, you may finish before it is gone.

After you keep a paper you are offered a return key, shown once. Entered in
another browser, it restores your rights, not your history: you still have
to come across your papers in the space.

Choosing "Release it" prepares a furnace; it does not delete the paper.
Dropping the paper into the opening, or choosing "Place in furnace", is
the confirmation. Fire starts after the server confirms. Other visitors
see that paper burn in its original place, without a furnace. Ash remains
in the local furnace until you leave; the return button waits three seconds.
Escape can end a confirmed or unresolved view without undoing a release.

## Safety checks and reporting

New papers are checked before publication. With a configured OpenAI
credential, the server sends the paper's words to OpenAI for category and
context checks. Ordinary distress, regret, anger and accounts
of harm are allowed; clear threats, abuse, private identifying information,
harmful instructions, sexual exploitation and scams are refused.
An unavailable or uncertain check keeps the draft out of the shared space.
Publication is unavailable when checks are not configured or cannot complete.
A failed connection to the checks can be retried while keeping the open draft.
If a submission reply is lost, retrying uses the same words and request so it
cannot leave the paper twice.

An opened paper can be reported. Reporting alone never changes its status
or the shared total. A background review checks the paper and relevant
report context; only a clear violation or an operator's decision removes it.
Disagreements with notes, multiple notes that cannot safely be reduced to
one, uncertain results and exhausted checks go to an operator. Report
numbers alone are not proof. A lost report reply can be retried with its
original reason and note. Removed text disappears from open readings
immediately and gets no fire or final reading.

Only paper text and drawings, report reasons and relevant notes are sent to OpenAI;
cookies, return keys and visitor identities are not. We request that policy
responses are not stored, without making a promise about provider retention.
Our report notes expire after 30 days. Drafts are not sent before submission.
See the [moderation decision](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/004-configured-safety-review.md)
for the limits and operator workflow.

OpenAI helps turn released papers into images for the Gallery, a record
exhibition. When a Release paper burns, its words and drawing are deleted in
the same moment and sent to OpenAI once, from memory, to choose a small set
of image directions; only those directions are kept, never the note. Only
generated images that pass safety checks appear. Generation can fail; then
no record appears, and the original paper is still gone. Records have no
link back to their paper. Keep papers never become records. Records can be
reported; reports go to an operator and do not hide a record by themselves.

A planned music extension will use the same AI directions to shape a short
instrumental, performed in your browser only when you choose to listen.
It will not read the original note again or start sound automatically.
Music is not available in the current implementation.

## Who is who

There are no accounts. Each browser is its own anonymous visitor, set by a
cookie the first time you arrive; another browser profile or a private
window is someone else. The server decides what each visitor may do: only
the person who kept a paper can let it go, and only someone who has
witnessed a released paper can let that one go. The server log names each
visitor by a short alias, never by their words. See the
[permissions decision](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/007-people-and-permissions.md)
and the
[logging runbook](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/logging-runbook.md).

## References

- [Paper Crumple demo](https://github.com/item-develop/paper-crumple-demo) —
  the crumpled paper, its folding animation and its physics, reused under MIT
  from nagasawa (ITEM Inc.); `THIRD_PARTY_NOTICES.md` records what changed.
- Decision records:
  [real-time over SSE, recovered from snapshots](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/001-sse-snapshots.md)
  and [letting go while someone is reading](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/002-active-reader-final-read.md).
- [The furnace confirmation and its recovery rules](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/003-furnace-confirmation.md).
- [Project design notes](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/plan.md) —
  the implementation plan and design references the app is built from (the
  [Week 9 plan](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/crit-8/throwaway-week9-claude-package/throwaway-week9-plan.md)
  is kept at the `crit-8` tag).
