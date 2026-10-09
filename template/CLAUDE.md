# Local demo workflow

This repo was initialized by demo-workbench. Build the scene, not another website.
Edit `src/scene.js`, `src/render.js`, `assets/` and `demo.json`. The extracted gallery
in `site/` and vendored CLI in `.workbench/` are stable infrastructure.

1. Read README.md and demo.json. Agree on creative intent and a review budget.
2. Edit ordinary scene code/assets; preserve input originals.
3. `npm run demo:render -- --note "What changed"` creates the next immutable run,
   aligned reference packet (when a reference exists), and updates the SAME gallery.
4. `npm run demo:compare -- v001` verifies that version's exact evidence. Inspect
   `runs/v001/manifest.json` and `packet/packet.json` for hashes/timestamps.
5. Run the user's chosen critics in this ordinary Claude session. No API integration
   or scheduler is provided. Give them the exact run, rubric, sampled timestamps,
   comparison and full render. Report incomplete evidence or lack of convergence.
6. Produce review.json in the README schema, with that run's output/packet hashes;
   `npm run demo:review -- v001 --file review.json`. Never invent scores or reuse
   grades from another output. Review import is one-time and immutable in v1.
7. `npm run demo:serve` gives the loopback gallery. Inspect seeking, sound, aspect,
   old versions and pending/reviewed states. Stop after the agreed budget.

Never modify earlier run media, reviews or hashes. Render again for a new iteration.
Failed commands retain scratch and must not be portrayed as successful outputs.
Do not publish source, references, run bundles, conversations, or secrets. Only
`public/` is served; imported findings/notes are intentionally visible there.
No remote creation, commit, upload, network reconfiguration, OS install, global
Claude/Git setting change, or external bind is implied. Ask for separate approval.
