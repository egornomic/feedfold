import { Check, CircleAlert, Copy } from "lucide-react";
import { type ComponentProps, useEffect, useRef, useState } from "react";
import { copyText } from "./clipboard.js";

export function CopyCodeButton({ getText }: { getText: () => string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current);
    },
    [],
  );

  async function copy() {
    if (resetTimer.current) clearTimeout(resetTimer.current);
    try {
      await copyText(getText());
      setStatus("copied");
    } catch {
      setStatus("error");
    }
    resetTimer.current = setTimeout(() => setStatus("idle"), 2500);
  }

  return (
    <button
      className="code-copy-button"
      type="button"
      aria-label="Copy code"
      onClick={() => void copy()}
    >
      {status === "copied" ? (
        <Check size={14} aria-hidden="true" />
      ) : status === "error" ? (
        <CircleAlert size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
      <span className="sr-only" role="status">
        {status === "copied" ? "Copied" : status === "error" ? "Could not copy" : "Copy"}
      </span>
    </button>
  );
}

export function CodeBlock(props: ComponentProps<"pre">) {
  const codeRef = useRef<HTMLPreElement>(null);
  return (
    <div className="article-code-block">
      <CopyCodeButton getText={() => codeRef.current?.textContent ?? ""} />
      <pre {...props} ref={codeRef} />
    </div>
  );
}
