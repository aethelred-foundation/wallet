import { createServer, type Server } from "node:http";

import { test, expect } from "./fixtures";

let server: Server;
let origin: string;

test.beforeAll(async () => {
  server = createServer((_request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; script-src 'none'; style-src 'none'; connect-src 'none'",
    });
    response.end("<!doctype html><html><head><title>Strict CSP dApp</title></head><body></body></html>");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Strict-CSP test server did not expose a TCP port");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("injects the EIP-1193 provider when the dApp blocks every page script", async ({
  strictCspContext,
}) => {
  const page = await strictCspContext.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Boolean(
            (window as typeof window & {
              aethelred?: { isAethelred?: boolean; request?: unknown };
            }).aethelred?.isAethelred,
          ),
      ),
    )
    .toBe(true);

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          typeof (
            window as typeof window & {
              aethelred?: { request?: unknown };
            }
          ).aethelred?.request,
      ),
    )
    .toBe("function");

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const provider = (
          window as typeof window & {
            aethelred?: {
              request?: (args: { method: string }) => Promise<unknown>;
            };
          }
        ).aethelred;
        return provider?.request?.({ method: "eth_chainId" });
      }),
    )
    .toBe("0x1ca4");

  await page.close();
});
