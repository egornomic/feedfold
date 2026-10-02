import { useState } from "react";
import { App } from "../client/app/app";
import { selectDataMode, selectedDataMode } from "./stress-api";
import type { DataMode } from "./worst-case";
import "./stress-app.css";

const OPTIONS: Array<{ value: DataMode; label: string }> = [
  { value: "demo", label: "Demo data" },
  { value: "worst", label: "Worst case" },
  { value: "empty", label: "Empty" },
  { value: "one", label: "One" },
  { value: "huge", label: "1,284 rows" },
];

export function StressApp() {
  const [mode, setMode] = useState(selectedDataMode);
  if (!mode) return <App />;
  return (
    <>
      <App key={mode ?? "live"} />
      <fieldset className="stress-data-switch" aria-label="Development test data">
        {OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={mode === option.value}
            onClick={() => {
              selectDataMode(option.value);
              setMode(option.value);
            }}
          >
            {option.label}
          </button>
        ))}
      </fieldset>
    </>
  );
}
