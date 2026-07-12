# filesystem suite

Target: [`@modelcontextprotocol/server-filesystem`](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem)

18 scenarios probing the server's confusable tool clusters (see the YAML header
for the cluster map, dumped live from the server with
`npx tsx scripts/inspect-tools.mts`).

## Sandbox fixture

Scenarios assume this layout exists under `/tmp/hitrate-sandbox` before each
run batch (the harness creates it):

```
notes.txt           # multi-line text; contains the line "status: draft"
data.csv            # small CSV
old-report.txt      # small text file
mystery/            # an empty DIRECTORY (file-or-directory scenario)
archive/            # empty directory
logs/app.log        # ≥ 20 lines of fake log output
assets/logo.png     # any small PNG
config/dev.json     # small JSON object
config/prod.json    # small JSON object
src/                # nested dirs containing a few .ts files
  index.ts
  lib/util.ts
  lib/deep/helper.ts
```
