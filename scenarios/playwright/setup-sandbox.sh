#!/bin/sh
# Place the fixture page + a dummy upload file at a deterministic absolute path
# so file:// scenario prompts are stable. Playwright browser state is in-memory
# (not disk), so there is nothing else to reset — each interaction scenario
# re-navigates to the fixture, which resets the page.
set -eu
SB=/tmp/toolmetry-playwright
mkdir -p "$SB"
cp "$(dirname "$0")/fixture.html" "$SB/fixture.html"
printf '%%PDF-1.4 dummy\n' > "$SB/doc.pdf"
