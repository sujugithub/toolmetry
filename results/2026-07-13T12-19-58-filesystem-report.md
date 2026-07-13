# filesystem: baseline vs optimized

**Hit rate 94% → 100% (+6 pts)** — 18 scenarios × 5 runs on accounts/fireworks/models/gpt-oss-120b.

| metric | baseline | optimized | Δ (pts) |
|---|---|---|---|
| hit rate | 94% | 100% | **+6** |
| arg correctness | 100% | 100% | ±0 |
| extra-call rate | 26% | 9% | -17 |
| strict success | 74% | 91% | **+17** |

## Per scenario (hit rate)

| scenario | baseline | optimized | Δ (pts) |
|---|---|---|---|
| read-whole-text-file | 100% | 100% | ±0 |
| read-first-lines | 100% | 100% | ±0 |
| read-last-lines | 100% | 100% | ±0 |
| read-image-file | 100% | 100% | ±0 |
| compare-two-configs | 0% | 100% | **+100** |
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

## Rewritten descriptions

### read_file

DEPRECATED. Do not call this tool. Use read_text_file for text files and read_media_file for images and other media. Only works within allowed directories.

### read_text_file

Use this ONLY to read a single text file. For two or more files — including when comparing, analyzing, or reading them sequentially — always use read_multiple_files instead. Use the 'head' or 'tail' parameter to read only the first or last N lines. Only works within allowed directories.

### read_multiple_files

Use this to read two or more text files in a single call, such as when comparing or analyzing them. Always prefer this over read_text_file when multiple files are involved. Each file's content is returned with its path as a reference. Only works within allowed directories.

### read_media_file

Use this when the user wants to view or load an image, audio, or other media file. The file is returned as an image, audio, or embedded resource content block. Do not use read_file for media files. Only works within allowed directories.

### write_file

Use this to create a new text file or overwrite an existing one with the exact content provided. Automatically creates any missing parent directories. Do not call create_directory first. Only works within allowed directories.

### create_directory

Use this ONLY when the user explicitly asks to create a new directory or folder. Call exactly once with the final full nested path; all missing parent directories are created automatically. Do not create parent directories separately, do not call this tool multiple times for the same path, and do not call it before write_file or move_file. Only works within allowed directories.

### list_directory

Use this for a flat, non-recursive listing of a single directory. Results clearly distinguish files with [FILE] and directories with [DIR] prefixes. For recursive pattern searches, use search_files instead. Only works within allowed directories.

### list_directory_with_sizes

Use this only when the user asks for a directory listing that includes file sizes. For a simple listing without sizes, use list_directory instead. Only works within allowed directories.

### directory_tree

Use this only when the user asks for a recursive tree view of a directory structure. Do not use it to search for specific file types; use search_files for that. Only works within allowed directories.

### move_file

Use this to move or rename a file or directory by providing the source and the full destination file path. Automatically creates any missing destination directories. Do not call list_directory, get_file_info, or create_directory beforehand to verify or prepare the source or destination. Only works within allowed directories.

### search_files

Use this to find files by a glob pattern across subdirectories, such as '**/*.ext'. Returns the full paths of all matches. Do not use this for a simple flat listing of one directory; use list_directory instead. Only searches within allowed directories.

### get_file_info

Use this only when the user asks for metadata such as size, modification time, or permissions. Do not call it merely to check that a file exists before reading or moving it. Only works within allowed directories.

### list_allowed_directories

Use this only when the user asks which directories are accessible, or when a file operation returns a permission error. Do not call it before every read or write operation. Only works within allowed directories.

_Measurement cost: baseline unknown (no pricing data) + optimized $0.3008 (excl. rewriter call)._
