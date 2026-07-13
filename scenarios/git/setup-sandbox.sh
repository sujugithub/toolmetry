#!/bin/sh
# Recreate /tmp/hitrate-git-sandbox: main with 3 commits, feature/login branch,
# staged change (config.txt), unstaged change (app.txt), untracked notes.txt.
set -eu
SB=/tmp/hitrate-git-sandbox
rm -rf "$SB"
mkdir -p "$SB"
cd "$SB"
git init -q -b main
git config user.email hitrate@example.com
git config user.name hitrate

echo "# Demo project" > README.md
git add . && git commit -qm "initial commit"

echo "console.log('v1')" > app.txt
git add . && git commit -qm "add app"

echo "debug=false" > config.txt
git add . && git commit -qm "add config"

git branch feature/login
git checkout -q feature/login
echo "console.log('login stub')" >> app.txt
git commit -qam "start login feature"
git checkout -q main

# staged change
echo "debug=true" > config.txt
git add config.txt
# unstaged change
echo "console.log('v2')" > app.txt
# untracked file
echo "todo: cleanup" > notes.txt
