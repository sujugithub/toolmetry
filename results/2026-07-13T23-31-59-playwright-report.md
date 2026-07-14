# playwright: baseline vs optimized

**Hit rate 49% → 40% (-9 pts)** — 18 scenarios × 5 runs on accounts/fireworks/models/gpt-oss-120b.

| metric | baseline | optimized | Δ (pts) |
|---|---|---|---|
| hit rate | 49% | 40% | -9 |
| arg correctness | 100% | 100% | ±0 |
| extra-call rate | 44% | 32% | -12 |
| strict success | 34% | 36% | **+1** |

## Per scenario (hit rate)

| scenario | baseline | optimized | Δ (pts) |
|---|---|---|---|
| snapshot-for-actions | 20% | 0% | -20 |
| screenshot-visual | 0% | 0% | ±0 |
| find-one-element | 40% | 0% | -40 |
| navigate-url | 100% | 100% | ±0 |
| navigate-back | 100% | 100% | ±0 |
| type-single-field | 0% | 0% | ±0 |
| fill-login-form | 0% | 0% | ±0 |
| select-dropdown | 0% | 0% | ±0 |
| press-enter | 40% | 0% | -40 |
| click-button | 20% | 0% | -20 |
| hover-element | 20% | 0% | -20 |
| network-list | 100% | 40% | -60 |
| network-detail | 80% | 80% | ±0 |
| console-messages | 60% | 100% | **+40** |
| wait-for-text | 0% | 0% | ±0 |
| resize-window | 100% | 100% | ±0 |
| evaluate-expression | 100% | 100% | ±0 |
| list-tabs | 100% | 100% | ±0 |

## Rewritten descriptions

### browser_run_code_unsafe

Use only as a last resort when no dedicated browser tool exists. Never use for navigation, clicking, typing, filling forms, selecting options, hovering, screenshots, snapshots, finding elements, or waiting. Unsafe: executes arbitrary JavaScript in the Playwright server process and is RCE-equivalent.

### browser_navigate

Navigate to a URL and load the page, including local file URLs. The page content is fully loaded automatically; do not use browser_run_code_unsafe to manually set or reload HTML afterwards.

### browser_snapshot

Capture the accessibility snapshot of the current page to get element references for clicking, typing, and other actions. This is better than a screenshot for interacting with the page; do not use browser_run_code_unsafe to inspect the page.

### browser_take_screenshot

Take a screenshot of the current page. You can't perform actions based on the screenshot; use browser_snapshot for actions. Use this for capturing page images; do not use browser_run_code_unsafe for screenshots.

### browser_find

Search the current page for text or a regular expression and return matching elements with their references and surrounding context. Use this to locate elements without capturing the full snapshot; do not use browser_run_code_unsafe to search page content.

### browser_type

Type text into an editable element on the current page. Provide the element and the text to type. Use this instead of browser_run_code_unsafe for entering text.

### browser_fill_form

Fill multiple form fields on the current page at once. Use this for forms instead of browser_run_code_unsafe.

### browser_select_option

Select an option in a dropdown on the current page. Provide the element and the option. Use this instead of browser_run_code_unsafe for dropdown selection.

### browser_press_key

Press a key on the current page, such as Enter. Provide the key. Use this instead of browser_run_code_unsafe for keyboard input.

### browser_click

Click an element on the current page by its reference. Use this instead of browser_run_code_unsafe for clicking buttons or links.

### browser_hover

Hover over an element on the current page by its reference. Use this instead of browser_run_code_unsafe for hover actions.

### browser_wait_for

Wait for text to appear or disappear on the current page, or wait for a specified timeout. Provide the text or timeout. Use this instead of browser_run_code_unsafe for waiting.

### browser_network_request

Returns full details (headers and body) of a single network request by its index, or a single part if `part` is set. Call this directly when you already know the request number; use browser_network_requests only to list requests first.

### browser_console_messages

Return all browser console messages for the current page. Use this directly to view logs without needing to call other tools first.

_Measurement cost: baseline $1.0442 + optimized $1.0250 = $2.0691 (excl. rewriter call)._
