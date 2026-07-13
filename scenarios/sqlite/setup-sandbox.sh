#!/bin/sh
# Recreate /tmp/hitrate-sqlite.db with the fixture schema + rows.
set -eu
rm -f /tmp/hitrate-sqlite.db
sqlite3 /tmp/hitrate-sqlite.db <<'EOF'
CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
INSERT INTO users VALUES (1,'Alice','alice@example.com'),(2,'Bob','bob@example.com'),(3,'Carol','carol@example.com');
CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, total REAL NOT NULL);
INSERT INTO orders VALUES (1,1,49.99),(2,2,15.00),(3,1,230.50);
EOF
