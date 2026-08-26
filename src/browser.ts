export const BROWSER_COMMAND = {
  browser: {
    description: "Check Kimi WebBridge browser access.",
    template:
      "Please check whether Kimi WebBridge is working by running `kimi-webbridge status`. If it is connected, tell me it is connected and ready to work in the browser. If it is not working or unavailable, send me the link to install the Kimi WebBridge extension from the Chrome Web Store: https://chromewebstore.google.com/detail/kimi-webbridge/fldmhceldgbpfpkbgopacenieobmligc and ask me to install and enable it, then run /browser again.",
  },
} as const;
