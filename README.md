# Throwaway

**Throwaway is a shared anonymous space for things people have been carrying in their minds and are ready to put down.**

A paper might contain a regret, a worry, an old memory, an unsaid sentence, a secret, or simply a thought that has occupied too much mental space. Instead of publishing it as a post, the user writes it on a piece of paper, crumples it, and throws it into a shared space filled with things other people have also chosen to leave behind.

The project is not intended to be an anonymous social network, confession feed, diary, or therapy tool. Its central interaction is a small ritual:

**write → crumple → throw → encounter → witness → possibly disappear**

> This README describes the whole design. The version deployed now is the
> Week 9 slice, which covers *write → crumple → throw → encounter*; see
> [What works in this first version?](#what-works-in-this-first-version) for
> exactly what exists today. Keep / Release, witnessing, real-time changes and
> destruction are planned and do not exist yet.

## What does “good” mean here?

A good Throwaway experience should make **leaving something behind feel meaningfully different from publishing content**.

Once a paper is thrown, it cannot be edited and does not appear in a personal archive. The system may remember ownership when necessary, but it does not help users retrieve their previous papers. Ownership exists for control, not for building a history.

Users choose between two ways of letting go.

**Keep it** means that the writer is ready to put something down, but still wants control over whether it eventually disappears. Only the same anonymous identity may destroy it if they encounter it again.

**Release it** means surrendering that control. Once released, the writer has no more destruction rights than any other visitor.

The shared space is designed around **encounters rather than feeds**. Papers are discovered spatially and randomly rather than through newest, trending, popular, searchable, or personalised lists. Witness counts are hidden until a paper is opened, so they cannot act as popularity signals.

Reading also does not automatically become a metric. A visitor must deliberately click **“I saw it”** before they are recorded as a witness. For a released paper, witnessing is required before destruction becomes possible.

This is important because destruction should not feel like clearing content from a database. It should feel consequential. There are no burn streaks, achievements, leaderboards, batch deletion, or rewards for destroying more papers.

Real-time behaviour exists to make the space feel inhabited, not to create a latest-content stream. When someone throws something away, connected visitors may see a new paper fall into their space, but its contents remain hidden until they choose to open it. When something is destroyed, the shared count changes for everyone.

## What is deliberately absent?

Throwaway does not include comments, likes, followers, public profiles, search, hashtags, trending content, private messages, or “My Papers”.

These are not missing features. They are rejected design choices.

The project should allow anonymous thoughts to be **seen without becoming social capital, remembered without becoming a profile, and destroyed only through deliberate acts of letting go.**

## What can be checked?

Some claims can be enforced automatically: thrown papers are immutable; non-owners cannot destroy `Keep it` papers; `Release it` papers require witnessing before destruction; one anonymous identity can witness a paper only once; destroyed papers disappear from the shared state for all users.

Other qualities require human judgement: whether throwing feels meaningfully different from posting, whether exploration feels like discovery rather than consumption, and whether burning feels reflective rather than rewarding.

Those subjective qualities are not secondary to the system. They are part of what “good” means for Throwaway.

## What works in this first version?

This is the Week 9 slice: the first version that is alive.

- You can write a paper of up to 2,000 characters, crumple and throw it into
  the shared space, and open papers other people left. Any language works, and
  line breaks are kept. The throw only plays after the server has saved it.
- Papers are stored in SQLite on a persistent Fly volume. They remain after
  you leave, and after the app restarts or is redeployed. Refresh the space to
  see papers other people have added since you arrived.
- The space shows up to twelve papers (six on a phone), chosen at random, and
  the number of papers still here. A closed paper shows no words, author, date
  or count.
- Each visitor gets an anonymous session cookie so the server can tell a retry
  of the same throw from a new paper. It is never shown or linked to a name.
- Every paper can also be opened from the keyboard, and if the 3D papers can't
  be drawn, plain buttons still open them.

For now every paper is readable by strangers and stays: there is no Keep or
Release choice yet, and nothing can be destroyed.

## What comes later?

Keep / Release, witnessing with "I saw it", burning, and real-time changes
(new papers falling into an open space, a shared count that updates for
everyone) are planned for later versions.

## References

- [Paper Crumple demo](https://github.com/item-develop/paper-crumple-demo) by
  nagasawa (ITEM Inc.), MIT licence. The crumpled paper, its folding animation
  and its physics are reused from it; `THIRD_PARTY_NOTICES.md` records what
  changed.
- [Project design notes](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/throwaway-week9-claude-package/throwaway-week9-plan.md):
  the Week 9 plan and design references this version is built from.
- [Crit 8: It's alive!](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/08-its-alive/)
  and the [final project brief](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/assessments/final-project/).
- [Fly Volumes overview](https://fly.io/docs/volumes/overview/): why one
  machine and one volume is enough for this version, and that a volume is
  neither replicated nor shared between machines.
