import type { AiProvider } from "../shared/types.js";

export interface AiDevice {
  id: string;
  key: CryptoKey;
}

const DATABASE = "feedfold-ai-vault";
const STORE = "devices";
const VERSION = "browser-v1";

async function openVault(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function deviceRecord(
  accountId: string,
  candidate?: AiDevice,
): Promise<AiDevice | undefined> {
  const database = await openVault();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, candidate ? "readwrite" : "readonly");
      const store = transaction.objectStore(STORE);
      const request = store.get(accountId);
      let device: AiDevice | undefined;
      request.onsuccess = () => {
        device = request.result as AiDevice | undefined;
        if (!device && candidate) {
          device = candidate;
          store.put(candidate, accountId);
        }
      };
      transaction.oncomplete = () => resolve(device);
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export async function aiDevice(accountId: string): Promise<AiDevice> {
  const existing = await deviceRecord(accountId);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
  // The write transaction chooses one key if two tabs initialize together.
  return (await deviceRecord(accountId, { id: crypto.randomUUID(), key })) as AiDevice;
}

export async function forgetAiDevice(accountId: string): Promise<void> {
  const database = await openVault();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(accountId);
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

function associatedData(
  accountId: string,
  deviceId: string,
  provider: AiProvider,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`${VERSION}:${accountId}:${deviceId}:${provider}`);
}

function encode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) =>
    character.charCodeAt(0),
  );
}

export async function encryptAiKey(
  device: AiDevice,
  accountId: string,
  provider: AiProvider,
  apiKey: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(accountId, device.id, provider) },
    device.key,
    new TextEncoder().encode(apiKey),
  );
  return `${VERSION}.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function decryptAiKey(
  device: AiDevice,
  accountId: string,
  provider: AiProvider,
  envelope: string,
): Promise<string> {
  try {
    const [version, iv, encrypted, extra] = envelope.split(".");
    if (version !== VERSION || !iv || !encrypted || extra !== undefined) throw new Error();
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: decode(iv),
        additionalData: associatedData(accountId, device.id, provider),
      },
      device.key,
      decode(encrypted),
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    throw new Error(
      "This browser cannot unlock the saved API key. Enter it again in Settings → AI.",
    );
  }
}
