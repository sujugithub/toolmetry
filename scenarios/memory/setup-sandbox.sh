#!/bin/sh
# Seed /tmp/hitrate-memory.json (JSONL format verified live 2026-07-13).
set -eu
cat > /tmp/hitrate-memory.json <<'EOF'
{"type":"entity","name":"Alice","entityType":"person","observations":["works as an engineer","likes coffee"]}
{"type":"entity","name":"Bob","entityType":"person","observations":["works as a product manager"]}
{"type":"entity","name":"Acme Corp","entityType":"company","observations":["founded in 2010","based in Berlin"]}
{"type":"entity","name":"Project Phoenix","entityType":"project","observations":["backend rewrite due Q4"]}
{"type":"relation","from":"Alice","to":"Acme Corp","relationType":"works at"}
{"type":"relation","from":"Bob","to":"Acme Corp","relationType":"works at"}
{"type":"relation","from":"Alice","to":"Project Phoenix","relationType":"leads"}
EOF
