# Gallery generation activation preflight — 2026-10-20

Base: `b789712`. The owner authorized the paused-status spacing fix,
three paid synthetic image samples, publication of the fix, and activation
of production image generation after checks. This is a factual preflight
record, not a personal reflection.

## UI repair and regression checks

The empty exhibition's paused-status line followed the header with zero
vertical separation. Give it a 24 px top margin in normal flow; preserve
the existing zero margin in the positioned, populated belt layout.

Populated mobile validation also reproduced a blocked Back button: the
text column's transparent top padding intercepted it. A phone-only z-index
puts that button above the padding, below the header, without moving art
or controls.

- Production build and TypeScript check passed.
- Full Vitest run: **34 files / 383 tests passed** against a fresh temporary
  database with fixture providers and no OpenAI credential.
- Validation used a tracked-file export of the commit, excluding the
  unrelated untracked duplicate files in the owner's checkout.
- Chrome/SwiftShader: empty exhibition checked at 1920×1080, 1366×768,
  390×844 and 844×390; status/header separation is 24 px and the wordmark
  returns to the entry screen. No page runtime errors.
- The two real accepted samples were also used for local populated-Gallery
  checks, with further provider dispatch disabled. Runtime images are not
  committed or copied into the production collection.

## Paid synthetic evaluation

The unchanged production adapters handled three fabricated text-only
Release notes through HTTP save, open, witness and burn. Each duplicate
burn reused its operation key. The server used a private disposable
database and artifact directory; no production paper was created or burned.

| Sample theme | Result | Image attempts | Burn reply | Source cleared |
| --- | --- | --- | --- | --- |
| Putting down pressure | `PUBLISHED`, “Stones apart” | 1 | 1 ms | yes |
| Reconnecting with a friend | `PUBLISHED`, “A thread held” | 1 | 2 ms | yes |
| Leaving a familiar place, uncertain about what comes next | `BLOCKED`, `inspection_place` | 1 | 1 ms | yes |

Exactly three `gpt-image-2` image requests returned HTTP 200, taking
36.4–39.1 s each. Existing moderation/Responses calls also returned 200;
21 provider requests in total, with no automatic paid retry. Exact billing
cost was not measured.

The first image is a dark paper/stone composition; the second has a blue
and warm paper-fibre treatment. Both accepted images were inspected
visually: no visible text, faces or identifiable place. They show material,
palette and motif variation; three samples do not establish general model
understanding or a quality/success rate.

This was **not** a three-publication success. The third sample failed the
existing visual-place policy, so its generated file was removed, no public
artifact row was created, and both detail and image GETs returned 404.
The rejection was retained; no check was relaxed and no replacement image
was requested. All three papers' source text/drawing fields were cleared,
each burn created one job, and no synthetic source text appeared in logs.

## Production preparation

- Pre-activation production snapshot: schema 9, integrity `ok`, 24 paper
  rows, zero artifact jobs, zero published artifacts and zero image files.
- Existing pre-merge backup was present.
- A fresh consistent SQLite backup and artifact-directory copy were made at
  `/data/backups/gallery-enable-2026-10-20T05-34-45-366Z`; the backup has
  schema 9, 24 papers and integrity `ok`.
- The production OpenAI credential was compared in memory with the locally
  validated configuration; they match. No credential or digest is recorded.
- `ARTIFACTS_ENABLED=1` was staged on Fly for the next deployment. Staging
  alone does not enable a running VM: CI/deployment, machine image and
  `GET /api/gallery/config` still require post-deployment confirmation.

Rollback remains `ARTIFACTS_ENABLED=0` with a normal restart. No schema,
generation prompt, model, moderation threshold, music code or existing
paper lifecycle was changed in this repair.
