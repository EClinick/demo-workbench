# Source provenance and rights

The gallery in `template/site/index.html` is extracted and generalized from
`site/index.html` in EClinick's Love Motion Recreation repository at commit
`f4b701baa1030b08c677f4e6294ff8ecf777e985` (approved source). Its original SHA-256
was `62c445db23ad466c9485fddbd9bb9d29e3d68df25101f300d74d678d74b256c9`.
`template/site/theme.css` and `theme.js` derive from the same commit and paths.
Generated projects carry these files under `site/` and this notice.

Extraction preserves the cool paper/ink/red theme, responsive showcase, media
tabs, expandable version history, comparison picker with synchronized seeking
and a single audible track, lightbox, score presentation, and theme preference.
Changes remove project-specific text, media, scores, remote links, external font
requests, and all conversation/replay/making-of content; add configurable aspect
ratios, manifest data, pending/empty states, downloads and safe refresh.

No license file was present at the approved source root. Reuse here is under the
user's explicit local-workbench authorization, not a claim of an open-source
license or permission to redistribute the original work. This package is private,
UNLICENSED, and intended for local use. Seek permission/license clarification
before distributing it. No font binaries are included. The gallery uses local
system sans and monospace fallbacks; it makes no font-service requests.

The CLI, renderer and media/server implementation are new code. FFmpeg, Git,
Node and npm are external installed tools with their own licenses. They are not
bundled. No original Love media, historical scores, or private session material
is included.
