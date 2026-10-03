self.addEventListener("activate", (event) => {
  // Reload controlled tabs even when an older app has lost its update UI to a render error.
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      // Navigation uses the new worker, so activation must finish before navigation can finish.
      for (const client of clients) void client.navigate(client.url);
    }),
  );
});
