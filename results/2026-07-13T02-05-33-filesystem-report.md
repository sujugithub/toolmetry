# filesystem: baseline vs optimized

**Hit rate 94% → 94% (+0 pts)** — 18 scenarios × 5 runs on claude-haiku-4-5.

| metric | baseline | optimized | Δ (pts) |
|---|---|---|---|
| hit rate | 94% | 94% | ±0 |
| arg correctness | 100% | 100% | ±0 |
| extra-call rate | 16% | 13% | -2 |
| strict success | 84% | 87% | **+2** |

## Per scenario (hit rate)

| scenario | baseline | optimized | Δ (pts) |
|---|---|---|---|
| read-whole-text-file | 100% | 100% | ±0 |
| read-first-lines | 100% | 100% | ±0 |
| read-last-lines | 100% | 100% | ±0 |
| read-image-file | 100% | 100% | ±0 |
| compare-two-configs | 0% | 0% | ±0 |
| count-lines-in-file | 100% | 100% | ±0 |
| list-directory-flat | 100% | 100% | ±0 |
| list-by-size | 100% | 100% | ±0 |
| nested-structure | 100% | 100% | ±0 |
| which-dirs-accessible | 100% | 100% | ±0 |
| create-new-file | 100% | 100% | ±0 |
| edit-one-line | 100% | 100% | ±0 |
| make-nested-directory | 100% | 100% | ±0 |
| rename-in-place | 100% | 100% | ±0 |
| move-into-archive | 100% | 100% | ±0 |
| find-by-extension | 100% | 100% | ±0 |
| file-metadata | 100% | 100% | ±0 |
| file-or-directory | 100% | 100% | ±0 |

_Measurement cost: baseline $0.6279 + optimized $0.6430 = $1.2709 (excl. rewriter call)._
