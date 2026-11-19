import { lookup } from "node:dns/promises";
import {
  createServer,
  type Server as HttpServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request as requestHttp,
  type ServerResponse,
} from "node:http";
import { type AddressInfo, BlockList, connect as connectTcp, isIP, type Socket } from "node:net";
import { ProxyAgent, fetch as undiciFetch } from "undici";

const blockedIpv4Addresses = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Addresses.addSubnet(network, prefix, "ipv4");
}

const blockedIpv6Addresses = new BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Addresses.addSubnet(network, prefix, "ipv6");
}

export type PublicNetworkErrorKind = "inaccessible" | "network";

export class PublicNetworkError extends Error {
  constructor(
    message: string,
    readonly kind: PublicNetworkErrorKind,
  ) {
    super(message);
    this.name = "PublicNetworkError";
  }
}

export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

export function isBlockedNetworkAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return blockedIpv4Addresses.check(address, "ipv4");
  if (version === 6) return blockedIpv6Addresses.check(address, "ipv6");
  return true;
}

export async function resolvePublicAddress(hostnameInput: string): Promise<PinnedAddress> {
  const hostname = hostnameInput
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    throw new PublicNetworkError(
      "This page is not public. Use a page that is available on the public internet.",
      "inaccessible",
    );
  }

  let addresses: PinnedAddress[];
  const literalFamily = isIP(hostname);
  if (literalFamily === 4 || literalFamily === 6) {
    addresses = [{ address: hostname, family: literalFamily }];
  } else {
    try {
      addresses = (await lookup(hostname, { all: true, verbatim: true }))
        .filter(
          (entry): entry is { address: string; family: 4 | 6 } =>
            entry.family === 4 || entry.family === 6,
        )
        .map((entry) => ({ address: entry.address, family: entry.family }));
    } catch {
      throw new PublicNetworkError(
        "Could not find this page's network address. Check the URL and try again.",
        "network",
      );
    }
  }

  if (addresses.length === 0) {
    throw new PublicNetworkError(
      "Could not find this page's network address. Check the URL and try again.",
      "network",
    );
  }
  if (addresses.some(({ address }) => isBlockedNetworkAddress(address))) {
    throw new PublicNetworkError(
      "This page is not public. Use a page that is available on the public internet.",
      "inaccessible",
    );
  }

  return addresses.find(({ family }) => family === 4) ?? (addresses[0] as PinnedAddress);
}

function publicHttpUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PublicNetworkError("Enter a valid public page URL.", "inaccessible");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new PublicNetworkError(
      "Enter a public URL that begins with http:// or https://.",
      "inaccessible",
    );
  }
  if (url.username || url.password) {
    throw new PublicNetworkError(
      "Remove the username and password from this URL. feedfold only supports public pages.",
      "inaccessible",
    );
  }
  return url;
}

function proxyError(response: ServerResponse): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  response.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
  response.end("Public target unavailable");
}

export type PublicAddressResolver = (hostname: string) => Promise<PinnedAddress>;

export class PinnedPublicProxy {
  readonly #server: HttpServer;
  readonly #sockets = new Set<Socket>();
  #url: string | null = null;

  constructor(
    private readonly connectTimeoutMs = 15_000,
    private readonly resolveAddress: PublicAddressResolver = resolvePublicAddress,
  ) {
    this.#server = createServer((request, response) => {
      void this.#forwardHttp(request, response);
    });
    this.#server.on("connect", (request, socket, head) => {
      void this.#forwardConnect(request, socket as Socket, head);
    });
    this.#server.on("connection", (socket) => this.#trackSocket(socket));
  }

  async url(): Promise<string> {
    if (this.#url) return this.#url;
    await new Promise<void>((resolve, reject) => {
      this.#server.once("error", reject);
      this.#server.listen(0, "127.0.0.1", () => {
        this.#server.off("error", reject);
        resolve();
      });
    });
    this.#server.unref();
    const address = this.#server.address() as AddressInfo;
    this.#url = `http://127.0.0.1:${address.port}`;
    return this.#url;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    this.#sockets.clear();
    if (!this.#server.listening) return;
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #forwardHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const target = publicHttpUrl(request.url ?? "");
      if (target.protocol !== "http:") {
        throw new PublicNetworkError("Use CONNECT for secure proxy requests.", "inaccessible");
      }
      const pinned = await this.resolveAddress(target.hostname);
      const headers: OutgoingHttpHeaders = { ...request.headers, host: target.host };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const upstream = requestHttp(
        {
          family: pinned.family,
          headers,
          host: pinned.address,
          method: request.method,
          path: `${target.pathname}${target.search}`,
          port: target.port ? Number(target.port) : 80,
        },
        (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode ?? 502,
            upstreamResponse.statusMessage,
            upstreamResponse.headers,
          );
          upstreamResponse.pipe(response);
        },
      );
      upstream.setTimeout(this.connectTimeoutMs, () => upstream.destroy());
      upstream.once("socket", (socket) => this.#trackSocket(socket));
      upstream.once("error", () => proxyError(response));
      request.once("aborted", () => upstream.destroy());
      request.pipe(upstream);
    } catch {
      proxyError(response);
    }
  }

  async #forwardConnect(request: IncomingMessage, client: Socket, head: Buffer): Promise<void> {
    let upstreamSocket: Socket | undefined;
    client.once("error", () => upstreamSocket?.destroy());
    try {
      const authority = request.url;
      if (!authority) throw new PublicNetworkError("The proxy target is missing.", "inaccessible");
      let target: URL;
      try {
        target = new URL(`http://${authority}`);
      } catch {
        throw new PublicNetworkError("The proxy target is invalid.", "inaccessible");
      }
      const port = target.port ? Number(target.port) : 443;
      if (!Number.isInteger(port) || port < 1 || port > 65_535) {
        throw new PublicNetworkError("The proxy target port is invalid.", "inaccessible");
      }
      const pinned = await this.resolveAddress(target.hostname);
      const upstream = connectTcp({
        family: pinned.family,
        host: pinned.address,
        port,
      });
      upstreamSocket = upstream;
      this.#trackSocket(upstream);
      client.once("close", () => upstream.destroy());
      const fail = (): void => {
        if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
        upstream.destroy();
      };
      upstream.setTimeout(this.connectTimeoutMs, fail);
      upstream.once("error", fail);
      upstream.once("connect", () => {
        upstream.setTimeout(0);
        upstream.off("error", fail);
        upstream.once("error", () => client.destroy());
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    } catch {
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    }
  }

  #trackSocket(socket: Socket): void {
    this.#sockets.add(socket);
    socket.once("close", () => this.#sockets.delete(socket));
  }
}

interface PublicNetworkRuntime {
  proxy: PinnedPublicProxy;
  proxyAgent: ProxyAgent;
  proxyUrl: string;
}

let runtimePromise: Promise<PublicNetworkRuntime> | null = null;

async function runtime(): Promise<PublicNetworkRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const proxy = new PinnedPublicProxy();
      const proxyUrl = await proxy.url();
      return {
        proxy,
        proxyAgent: new ProxyAgent({ uri: proxyUrl, proxyTunnel: true }),
        proxyUrl,
      };
    })();
  }
  return runtimePromise;
}

export async function publicProxyUrl(): Promise<string> {
  return (await runtime()).proxyUrl;
}

export async function fetchPublic(value: string, options: RequestInit = {}): Promise<Response> {
  const url = publicHttpUrl(value);
  await resolvePublicAddress(url.hostname);
  const { proxyAgent } = await runtime();
  const requestOptions: NonNullable<Parameters<typeof undiciFetch>[1]> = {
    ...(options as unknown as NonNullable<Parameters<typeof undiciFetch>[1]>),
    dispatcher: proxyAgent,
  };
  return (await undiciFetch(url, requestOptions)) as unknown as Response;
}

export async function closePublicNetwork(): Promise<void> {
  const pending = runtimePromise;
  runtimePromise = null;
  if (!pending) return;
  const { proxy, proxyAgent } = await pending.catch(() => ({
    proxy: null,
    proxyAgent: null,
  }));
  await proxyAgent?.destroy();
  await proxy?.close();
}
