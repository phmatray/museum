---
name: world-review
description: Playtest, critique and fix a place of the 3D museum the way a QA team, an art director and an architect would — find what a visitor would find illogical, ugly, dark, unreachable, missing or broken, then fix it and prove it with before/after captures. Use this skill whenever the user reports that a room, area or feature "looks wrong", "makes no sense", "is empty", "is ugly", has bugs they can see, asks to review/inspect/test/QA/polish a place (cinema, foyer, hall, garden, galleries, stairs, NPCs…), or asks you to find problems by yourself — even if they only name one symptom: the symptom is rarely the only problem in that place.
---

# World review: playtest, critique, fix

A place can be "correct" — it compiles, the tests pass, every box is where the plan says — and still be
wrong for the visitor: a glass railing that walls off the seats you are invited to sit in, a foyer that is
an empty box, house lights that snap off instead of dimming, a projection booth with no projector. Unit
tests do not see these. Screenshots alone do not either, unless someone looks at them **with an intent and
a reference in mind**. That is the job here: be the visitor, the art director and the architect at once,
then be the engineer who fixes it.

Vision is good at the gross and the semantic (missing things, wrong scale, nonsense layouts, dead lighting,
bad composition) and bad at the subtle (2 px seams, flicker, exact sizes). So: **numbers from code, judgement
from images, and every finding confirmed twice before it is fixed.**

## 1. Know what the place should be

Before capturing anything, write down (briefly, in the reply) the **expectations** for this place:

- **The real-world reference.** What does this kind of place contain and how does it behave in reality?
  A cinema: ticket/candy counter, posters ("À l'affiche", "Prochainement"), house lights that fade over
  seconds, step lights that stay on in the dark, a visible projection booth with a projector and a beam,
  exit signs, open aisles leading into each row. A foyer is furnished and lit like a place to wait. A
  staircase has a handrail at hand height and nothing at head height. If the user gave reference photos
  or a model (here: Les Variétés, Waremme), list what they show.
- **The visitor's intents.** Three to six concrete scenarios: "come down from the hall and find the
  cinema", "reach a seat in row 3 and sit", "start the film, then leave in the dark", "look for the
  projector". Each intent is a path plus the states it passes through (lights on → dimming → screening).
- **The states.** Day/night, weather, screening on/off, paused, mobile portrait, seated height. Transitions
  matter as much as states: capture *during* a change, not only before and after.

Read the code that builds the place first (`src/plan/<place>.ts`, `src/babylon/<place>.ts`, the plan rooms
in `src/plan/musee.ts`), so the critique can name causes, not only symptoms.

## 2. Capture like a visitor

Two scripts (run from the repo root, against a running dev server — `npm run dev`, or the LAN test server):

```bash
S=.claude/skills/world-review/scripts
node $S/vues.ts cinema ss-foyer > /tmp/…/vues.json      # viewpoints derived from the plan (see below)
node $S/revue.mjs --url=http://localhost:5173/ --vues=/tmp/…/vues.json --sortie=/tmp/…/revue [--largeur=1280 --hauteur=720]
```

- `vues.ts <room…>` derives viewpoints from the plan for each room id: looking in from each doorway,
  looking out, the centre in four directions, the four corners towards the centre, the bottom and top of
  each flight and each landing inside the room. Edit the JSON to add intent-driven views (a seat at seated
  eye height, the top of an aisle, the spot where the user saw the bug).
- A view is `{ nom, lieu: {level, surface, x, z, y, yaw, pitch}, apres?: [actions], rafale?: [ms…], url? }`.
  `apres` runs after placing: `{"touche":"Enter"}`, `{"attendre":2000}`, `{"eval":"js expression"}`.
  `rafale` takes several captures at those delays after the actions — use it for transitions (`[0, 400,
  1500, 4000]` around a light change). `url` adds query parameters (`heure=22:00`, `meteo=pluie`).
- `revue.mjs` writes one PNG per capture, `planche.png` (a contact sheet, when ImageMagick is installed),
  and `rapport.json`: per view the console errors (shader compile errors included), draw calls and
  triangles. **Read the errors first**: a material that fails to compile simply disappears, and the
  screenshot then shows "a grey wall" rather than an error.

Look at the contact sheet, then open the individual captures that matter at full size.

## 3. Critique through five lenses

For each capture and each intent, ask:

1. **Technical** — missing or black surfaces, z-fighting, floating or buried objects, wrong scale,
   mirrored text, stretched textures, objects through walls, console errors.
2. **Logic and navigation** — can the visitor actually do what the place invites? Is the path readable?
   Does anything block a path (a sconce in a stair, a railing in front of seats) or allow nonsense
   (walking through seats)? Is an interaction discoverable where the visitor stands?
3. **Lighting** — is the important thing lit and the rest calmer? Night/dark states usable (step lights,
   exit signs)? Transitions animated over a believable time rather than instant?
4. **Art direction** — composition from the entrance, a focal point, materials and colours consistent with
   the reference and the museum (Orsay-like), set dressing that makes the place inhabited, nothing
   gratuitous. An empty room is a finding.
5. **Fidelity to reality and to the reference** — every expectation from step 1 that is absent, wrong or
   invisible from where a visitor would look for it.

Write the findings as a table: id · view (and its `?lieu`) · lens · severity (blocking / visible / polish)
· what the visitor experiences · probable cause (file:line when known) · fix.

## 4. Confirm before fixing

A finding from one image can be an artefact of the angle or of the model's eyes. Before fixing, confirm
each one with a second view from another angle, a number from the code or the plan (heights, rects,
light intensities), or the console. Drop what does not survive, and say so.

## 5. Fix at the source, the plan first

- Logic and geometry go in `src/plan/` (pure, with a test that encodes the rule: "no guardrail between an
  aisle and its rows", "nothing between 0 and 2.10 m above a walking surface", "house lights fade over ≥ 2 s").
- Rendering goes in the layer's `src/babylon/<place>.ts`; follow the `babylonjs` skill for engine work.
- Prefer one fix at the shared cause over patches at each symptom.
- Run `npx tsc -b`, `npm run lint`, `NODE_OPTIONS=--no-webstorage npx vitest run`.

## 6. Prove it

Re-run `revue.mjs` with the same views into a new folder and compare before/after side by side
(`magick montage avant/x.png apres/x.png -tile 2x1 -geometry +4+4 cmp-x.png`). Report to the user: what was
found, what was fixed (with the before/after for the visible ones), what was dropped as a false alarm, and
what remains — honestly, including what could not be verified (WebGPU, a real phone).

## Before publishing: the production bundle

The dev server does not bundle; `npm run build` passing does not prove the bundle *runs*. On
2026-10-21 the published museum crashed at load (`ShaderStore` undefined) while every test and the
build were green. Before any publish, build, serve and load it:
`npm run build && npx vite preview --port 5190 &` then
`node .claude/skills/world-review/scripts/production.mjs http://localhost:5190/` — it must report a
canvas, the ticket and 0 errors. After the deploy, run it once more against the live URL.

## Limits worth stating

Still captures do not show animation quality (NPC limbs, walk cycles) — use `rafale` or a dedicated lab
page that isolates the asset. Asset defects (bad rigging, bad skinning from a generator) are fixed by
regenerating or replacing the asset, not in the engine; a side-by-side "native vs ours" lab proves which.
