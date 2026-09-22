import { useRegisterSW } from "virtual:pwa-register/react";
import { RefreshCw, X } from "lucide-react";
import { useMotionPresence } from "../ui/motion";

export function PwaUpdate() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();
  const presence = useMotionPresence(needRefresh);

  if (!presence.present) return null;

  return (
    <aside
      className="pwa-update"
      data-motion-state={presence.state}
      inert={presence.state === "closed" ? true : undefined}
      aria-live="polite"
      aria-label="feedfold update available"
    >
      <span>New version is available</span>
      <div className="pwa-update-actions">
        <button
          className="secondary-button"
          type="button"
          onClick={() => void updateServiceWorker()}
        >
          <RefreshCw aria-hidden="true" size={15} />
          Update
        </button>
        <button
          className="icon-button"
          type="button"
          aria-label="Dismiss update notice"
          onClick={() => setNeedRefresh(false)}
        >
          <X aria-hidden="true" size={16} />
        </button>
      </div>
    </aside>
  );
}
