---
name: kimi-webbridge
description: Control the user's real Chrome or Edge browser through Kimi WebBridge. Use for browser navigation, opening or managing tabs, reading pages, clicking, filling forms, taking screenshots, saving PDFs, uploading files, or automating websites with the user's existing browser sessions.
---

# Kimi WebBridge

Mosaic includes this skill and the `/browser` setup command. Kimi WebBridge
lets the agent work through the user's existing Chrome or Edge session, so the
user's logged-in pages remain on their computer.

## Setup

When the user invokes `/browser` or asks to connect browser access:

1. Run `kimi-webbridge upgrade` through the shell.
2. Send the user the official Kimi WebBridge Chrome extension link:
   https://chromewebstore.google.com/detail/kimi-webbridge/fldmhceldgbpfpkbgopacenieobmligc
3. Tell the user to install and enable the extension, then continue once it is
   connected.

Do not install a separate native browser bridge. The Mosaic installer provides
the Kimi WebBridge CLI, and this skill is shipped with Mosaic; the browser
extension is the only user download required. If the CLI is missing, tell the
user to rerun the Mosaic installer rather than fetching an untrusted substitute.

## Browser work

Use Kimi WebBridge for tasks that need the user's real browser, including
authenticated pages and sites that do not expose a useful API. Keep one short
session name for the whole task, use one tab group per task, and leave tabs
open unless the user asks to close them. Only inspect tabs and pages relevant to
the current task; never inspect the active tab unless the user explicitly asks.

Never read or expose cookies, passwords, authentication headers, access tokens,
or unrelated page content. Return only the browser data needed for the task.

The Chrome link above is the fixed official listing whose publisher website is
Kimi. If it stops resolving, direct the user to the official WebBridge page
instead of substituting a third-party extension download.

Before interacting, inspect the current page. Prefer semantic element
references returned by the bridge over brittle CSS selectors. After important
navigation or form actions, verify the result from the returned page state or
a screenshot.

Treat the browser as the user. Ask for confirmation immediately before sending
messages, publishing, purchasing, deleting important data, changing passwords,
or changing account settings.
