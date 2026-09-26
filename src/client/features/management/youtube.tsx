import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { appUrl, errorMessage } from "../../api/api-contract";
import { httpRequest } from "../../api/http-request";
import { youtubeQuery } from "../../api/query";
import { useRequestMutation } from "../../api/use-request-mutation";
import { Modal, useDialog } from "../../ui/dialog";

export function YouTubeSettings({ userId }: { userId: string }) {
  const statusQuery = useQuery(youtubeQuery(userId));
  const status = statusQuery.data ?? null;
  const { run: mutateRequest } = useRequestMutation();
  const [busy, setBusy] = useState(false);
  const [actionError, setError] = useState<string | null>(null);
  const error = actionError ?? (statusQuery.error ? errorMessage(statusQuery.error) : null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const connectDialog = useDialog(() => setError(null), { autoOpen: false });
  const headers = { "X-Feedfold-Account": userId };

  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("youtube");
    if (result) {
      setNotice(
        result === "connected"
          ? "YouTube connected and subscriptions synced."
          : result === "cancelled"
            ? "YouTube connection cancelled. Your feeds have not changed."
            : "YouTube could not finish connecting. Check the connection status below and try again.",
      );
      url.searchParams.delete("youtube");
      window.history.replaceState(window.history.state, "", url);
    }
  }, []);

  const act = async (action: "connect" | "disconnect" | "status", filterShorts = false) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (action === "connect") {
        const { url } = await mutateRequest(() =>
          httpRequest<{ url: string }>("/api/youtube/connect", {
            method: "POST",
            headers,
            body: JSON.stringify({ filterShorts }),
          }),
        );
        window.location.assign(url);
        return;
      }
      if (action === "disconnect") {
        await mutateRequest(() => httpRequest<void>("/api/youtube", { method: "DELETE", headers }));
        setConfirmDisconnect(false);
        setNotice("YouTube disconnected. Synced feeds and their reading history were removed.");
      }
      await statusQuery.refetch();
    } catch (caught) {
      setError(errorMessage(caught));
      await statusQuery.refetch();
    } finally {
      setBusy(false);
    }
  };

  if (status && !status.available) return null;
  return (
    <section className="settings-section" aria-labelledby="youtube-heading" aria-busy={busy}>
      <div className="settings-heading">
        <h2 id="youtube-heading">YouTube</h2>
        <p>Sync your subscribed channels daily.</p>
      </div>
      <div className="setting-row">
        <div>
          <strong>{status?.connected ? status.channelTitle : "Subscriptions"}</strong>
          <p>
            {status?.connected
              ? `${status.feedCount} synced ${status.feedCount === 1 ? "feed" : "feeds"}${status.lastSyncAt ? ` · Last synced ${new Date(status.lastSyncAt).toLocaleString()}` : " · Waiting for the first sync"}`
              : "Read-only access. Feedfold cannot change your YouTube account."}
          </p>
          <p>
            <a href={appUrl("/privacy")} target="_blank" rel="noreferrer">
              Privacy policy
            </a>
          </p>
        </div>
        <div className="settings-actions">
          {!status ? (
            <span role="status">
              {error ? (
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void act("status")}
                >
                  Retry connection status
                </button>
              ) : (
                "Loading connection…"
              )}
            </span>
          ) : status.connected ? (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect
            </button>
          ) : (
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setError(null);
                connectDialog.open();
              }}
            >
              Connect YouTube
            </button>
          )}
        </div>
      </div>
      {status?.connected ? (
        <div className="setting-row">
          <div>
            <p>
              Unsubscribing on YouTube also removes that channel’s feed, saved articles, and reading
              history from Feedfold.
            </p>
            <p>
              <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
                Manage Google access
              </a>
            </p>
          </div>
        </div>
      ) : null}
      {confirmDisconnect ? (
        <div className="setting-row">
          <div>
            <strong>Disconnect YouTube?</strong>
            <p>
              This revokes Google access and removes your synced feeds and their reading history,
              including saved articles. It does not change your YouTube subscriptions.
            </p>
          </div>
          <div className="settings-actions">
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => setConfirmDisconnect(false)}
            >
              Cancel
            </button>
            <button
              className="danger-button"
              type="button"
              disabled={busy}
              onClick={() => void act("disconnect")}
            >
              Disconnect and remove feeds
            </button>
          </div>
        </div>
      ) : null}
      {error || status?.error ? (
        <div className="setting-row" role="alert">
          <p>{error ?? status?.error}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="setting-row" role="status">
          <p>{notice}</p>
        </div>
      ) : null}
      <Modal
        dialog={connectDialog}
        className="management-dialog youtube-connect-dialog"
        aria-labelledby="youtube-connect-title"
        aria-describedby="youtube-connect-description"
        dismissible={!busy}
      >
        <header className="management-dialog-heading">
          <h2 id="youtube-connect-title">Hide Shorts from your feed?</h2>
          <button
            className="icon-button"
            type="button"
            disabled={busy}
            onClick={connectDialog.close}
            aria-label="Cancel YouTube connection"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className="management-dialog-body">
          <p id="youtube-connect-description">
            Hide Shorts adds a rule to your YouTube folder. You can change it later in Rules.
          </p>
          {error ? (
            <div className="management-dialog-error" role="alert">
              {error}
            </div>
          ) : null}
          {busy ? <p role="status">Connecting…</p> : null}
        </div>
        <footer className="management-dialog-footer">
          <span />
          <div>
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void act("connect", false)}
            >
              Include Shorts
            </button>
            <button
              className="primary-button"
              type="button"
              disabled={busy}
              onClick={() => void act("connect", true)}
            >
              Hide Shorts
            </button>
          </div>
        </footer>
      </Modal>
    </section>
  );
}
