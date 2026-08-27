---
name: kimi-webbridge
description: Control the user's real Chrome or Edge browser through Kimi WebBridge. Use for browser navigation, opening or managing tabs, reading pages, clicking, filling forms, taking screenshots, saving PDFs, uploading files, or automating websites with the user's existing browser sessions.
---

# Kimi WebBridge

Mosaic includes this skill and the `/browser` connection check. Kimi WebBridge
lets the agent work through the user's existing Chrome or Edge session, so the
user's logged-in pages remain on their computer.

## Setup

When the user invokes `/browser` or asks to check browser access:

1. Run `kimi-webbridge status` through the shell.
2. If the status confirms that WebBridge is connected, tell the user it is
   connected and ready to work in the browser.
3. If the command fails or reports that WebBridge is not connected, send the
   user the official Chrome extension link:
   https://chromewebstore.google.com/detail/kimi-webbridge/fldmhceldgbpfpkbgopacenieobmligc
4. Ask the user to install and enable the extension, then run `/browser` again.

The Kimi WebBridge CLI and this skill are already provided to the agent. Do not
install or upgrade the CLI from this skill, and do not fetch an untrusted
substitute. The browser extension is the only user download required.

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
