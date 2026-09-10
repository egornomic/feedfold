import { useEffect, useState } from "react";
import type { InvitationSummary, Invitations } from "../../shared/types";
import { api, appUrl, errorMessage } from "../api";

function invitationStatus(invitation: InvitationSummary): string {
  if (invitation.redeemedAt) return "Used";
  if (invitation.revokedAt) return "Revoked";
  if (invitation.expiresAt <= new Date().toISOString()) return "Expired";
  return "Available";
}

export function InvitationsSection({ showToast }: { showToast: (message: string) => void }) {
  const [data, setData] = useState<Invitations | null>(null);
  const [created, setCreated] = useState<Awaited<ReturnType<typeof api.createInvitation>> | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .invitations()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((caught) => {
        if (active) setError(errorMessage(caught));
      });
    return () => {
      active = false;
    };
  }, []);

  const mutate = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setData(await api.invitations());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const create = (replaceId?: string) =>
    mutate(async () => {
      setCreated(await api.createInvitation(replaceId));
      showToast(replaceId ? "Invitation replaced" : "Invitation created");
    });

  const copy = async (link: boolean) => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(
        link
          ? new URL(`${appUrl("/join")}#${created.code}`, window.location.origin).href
          : created.code,
      );
      showToast(link ? "Invite link copied" : "Invite code copied");
    } catch {
      setError("Could not copy. Select and copy the code below.");
    }
  };

  if (data && !data.enabled) return null;
  const activeInvitation = data?.invitations.find(
    (invite) => invitationStatus(invite) === "Available",
  );
  const canCreate = data && data.remaining !== 0 && (data.unlimited || !activeInvitation);

  return (
    <section
      className="settings-section"
      aria-labelledby="invitations-heading"
      aria-busy={busy || !data}
    >
      <div className="settings-heading">
        <h2 id="invitations-heading">Invitations</h2>
        <p>
          {!data
            ? "Loading invitations…"
            : data.unlimited
              ? "Invite as many friends as you like. Each invitation admits one person."
              : data.remaining === 0
                ? "Your invitation has been used. Your friend now has one to share."
                : "Invite one friend. They’ll get one invitation of their own."}
        </p>
      </div>
      {data ? (
        <div className="account-setting-block">
          {canCreate ? (
            <div className="passkey-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={busy}
                onClick={() => void create()}
              >
                Create invitation
              </button>
            </div>
          ) : null}
          {created ? (
            <div className="invitation-share" role="status">
              <label className="login-field" htmlFor="created-invite-code">
                <span>Invitation {created.number} · Invite code</span>
                <input
                  id="created-invite-code"
                  value={created.code}
                  readOnly
                  onFocus={(event) => event.target.select()}
                />
              </label>
              <div className="passkey-actions">
                <button type="button" className="primary-button" onClick={() => void copy(true)}>
                  Copy invite link
                </button>
                <button type="button" className="secondary-button" onClick={() => void copy(false)}>
                  Copy code
                </button>
              </div>
              <p className="account-setting-note">
                Copy it now. You can replace an unused invitation if you lose its code. Invitations
                expire after 30 days.
              </p>
            </div>
          ) : null}
          {data.invitations.length ? (
            <ul className="passkey-list invitation-list">
              {data.invitations.map((invite) => {
                const status = invitationStatus(invite);
                return (
                  <li key={invite.id}>
                    <div className="passkey-copy">
                      <strong>Invitation {invite.number}</strong>
                      <p>
                        {status} · {status === "Available" ? "Expires" : "Created"}{" "}
                        {new Date(
                          status === "Available" ? invite.expiresAt : invite.createdAt,
                        ).toLocaleDateString()}
                      </p>
                    </div>
                    {status === "Available" ? (
                      <div className="passkey-actions">
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          aria-label={`Replace invitation ${invite.number}`}
                          onClick={() => void create(invite.id)}
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          disabled={busy}
                          aria-label={`Revoke invitation ${invite.number}`}
                          onClick={() =>
                            void mutate(async () => {
                              await api.revokeInvitation(invite.id);
                              if (created?.id === invite.id) setCreated(null);
                              showToast("Invitation revoked");
                            })
                          }
                        >
                          Revoke
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <p className="login-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
