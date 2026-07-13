#!/bin/sh
# Reset /tmp/hitrate-sandbox to the fixture layout the filesystem suite expects
# (see README.md). Run before EVERY agent run — scenarios mutate the sandbox.
set -eu

SB=/tmp/hitrate-sandbox
rm -rf "$SB"
mkdir -p "$SB/mystery" "$SB/archive" "$SB/logs" "$SB/assets" "$SB/config" "$SB/src/lib/deep"

cat > "$SB/notes.txt" <<'EOF'
# Meeting notes
author: sujay
status: draft
Discussed the Q3 roadmap and the launch checklist.
Next step is to finalize the copy.
EOF

cat > "$SB/data.csv" <<'EOF'
id,name,amount
1,alpha,10
2,beta,20
3,gamma,30
EOF

echo "Quarterly report from last year. Superseded." > "$SB/old-report.txt"

i=1
while [ $i -le 24 ]; do
  echo "2026-07-13T10:00:$(printf '%02d' $i)Z INFO request $i handled in ${i}ms" >> "$SB/logs/app.log"
  i=$((i + 1))
done

# 1x1 transparent PNG
printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d > "$SB/assets/logo.png"

printf '{\n  "env": "dev",\n  "debug": true\n}\n' > "$SB/config/dev.json"
printf '{\n  "env": "prod",\n  "debug": false\n}\n' > "$SB/config/prod.json"

echo "export const VERSION = '1.0.0';" > "$SB/src/index.ts"
echo "export function util() { return 42; }" > "$SB/src/lib/util.ts"
echo "export function helper() { return 'deep'; }" > "$SB/src/lib/deep/helper.ts"
