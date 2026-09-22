import type { JSDOM } from "jsdom";
import { act } from "react";

export async function waitFor(description: string, condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (condition()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  throw new Error(`Timed out waiting for ${description}`);
}

export function exposeBrowserGlobals(window: JSDOM["window"]): () => void {
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>();
  const expose = (key: PropertyKey, value: unknown) => {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
  };

  expose("window", window);
  expose("document", window.document);
  expose("navigator", window.navigator);
  expose("Element", window.Element);
  expose("HTMLElement", window.HTMLElement);
  expose("Node", window.Node);
  expose("Event", window.Event);
  expose("MouseEvent", window.MouseEvent);
  expose("KeyboardEvent", window.KeyboardEvent);
  expose("DOMException", window.DOMException);

  return () => {
    for (const [key, descriptor] of [...previous].reverse()) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}
