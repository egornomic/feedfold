import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import { expect, it } from "vitest";
import { copyText } from "../../src/client/platform/clipboard.js";

it("removes temporary text and reports failure when copying is unsupported", async () => {
  const dom = new JSDOM("<body></body>");
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", { configurable: true, value: dom.window.document });
  try {
    await expect(copyText("Code to copy")).rejects.toThrow();
    expect(dom.window.document.body.textContent).toBe("");
    expect(dom.window.document.querySelector("textarea")).toBeNull();
  } finally {
    Object.defineProperty(globalThis, "document", { configurable: true, value: previousDocument });
    dom.window.close();
  }
});

it("copies exact code text on both secure and non-secure pages", async () => {
  const code = '\tconsole.log("<tag>");\n';
  const bundle = await build({
    stdin: {
      contents: `import { copyText } from ${JSON.stringify(resolve("src/client/platform/clipboard.ts"))};
        document.querySelector('button').onclick = async () => {
          await copyText(${JSON.stringify(code)});
          document.querySelector('output').textContent = 'Copied';
        };`,
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
  });
  const server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end(
      `<button>Copy</button><output></output><script>${bundle.outputFiles[0]?.text}</script>`,
    );
  });
  await new Promise<void>((done) => server.listen(0, "0.0.0.0", done));
  const port = (server.address() as AddressInfo).port;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      permissions: ["clipboard-read", "clipboard-write"],
    });
    const reader = await context.newPage();
    await reader.goto(`http://localhost:${port}`);
    const page = await context.newPage();
    for (const host of ["0.0.0.0", "localhost"]) {
      await reader.evaluate(() => navigator.clipboard.writeText("before copying"));
      await page.goto(`http://${host}:${port}`);
      expect(await page.evaluate(() => typeof navigator.clipboard)).toBe(
        host === "localhost" ? "object" : "undefined",
      );
      await page.getByRole("button", { name: "Copy" }).click();
      await page.getByText("Copied", { exact: true }).waitFor();
      await reader.bringToFront();
      expect(await reader.evaluate(() => navigator.clipboard.readText())).toBe(code);
    }
  } finally {
    await browser.close();
    await new Promise<void>((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
});
