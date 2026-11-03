# Evidence: optional accounts (ADR 009), 2026-11-03

One headless Chromium pass on the GPU (`ANGLE Metal Renderer: Apple M4 Pro`)
against a local production build (`pnpm build`, fixture moderation, a fresh
temporary database), branch `feat/optional-accounts`. Not production.

| Shot | What it shows |
| --- | --- |
| `desktop-1-guest-header.jpg` | 1920×1080 guest: Gallery · About · Sign in at the top right |
| `desktop-2-offer-after-keep.jpg` | the suggestion ~1.8 s after a guest's first Keep, with Not now and the no-recovery notice |
| `desktop-3-your-papers.jpg` | signed in: the username replaces Sign in; the private panel lists the Keep |
| `desktop-4-wrong-password.jpg` | a second browser profile, wrong password: one plain refusal |
| `desktop-5-opened-from-panel.jpg` | that profile, signed in, opens the Keep from its panel ("You left this here.") |
| `desktop-6-burned.jpg` | and lets it go: the furnace burns it to ash |
| `phone-1-guest-header.jpg` | 390×844: About stays first in the stacked links, no horizontal scroll |
| `phone-2-create-account.jpg` | Create account on a phone |
| `phone-3-your-papers-empty.jpg` | a new account's empty panel |

Assertions passed in the same run: header order on desktop and phone, the
offer after a Keep, the username after sign-up, the Keep in the panel, sign
out back to Sign in, the wrong-password message, opening and burning the
Keep from the other profile, and no horizontal scroll on the phone.

Here the Keep happened to be in the second profile's room window, so it
burned in the 3D furnace. A paper outside the window opens with no 3D sheet
and burns in the drawn furnace; that path is covered by
`spec/account-ui.test.ts`, not by this pass.

Not checked here: a record playing in the panel (it needs a published
Gallery record, which this local run does not generate), Safari, a physical
phone.
