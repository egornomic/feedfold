import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { INVITE_EXPIRATION_DAYS } from "../../../shared/auth";
import type { InvitationSummary } from "../../../shared/types";
import { api, appUrl, errorMessage } from "../../api/api";
import { useRequestMutation } from "../../api/use-request-mutation";

type InvitationStatus = "Available" | "Expired" | "Revoked" | "Used";

function invitationStatus(invitation: InvitationSummary): InvitationStatus {
  if (invitation.redeemedAt) return "Used";
  if (invitation.revokedAt) return "Revoked";
  if (invitation.expiresAt <= new Date().toISOString()) return "Expired";
  return "Available";
}

export function InvitationsSection({ showToast }: { showToast: (message: string) => void }) {
  const overviewQuery = useQuery({ queryKey: ["invitations"], queryFn: api.invitations });
  const overview = overviewQuery.data;
  const mutation = useRequestMutation();
  const busy = mutation.isPending;
  const [createdInvitation, setCreatedInvitation] = useState<Awaited<
    ReturnType<typeof api.createInvitation>
  > | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshAfterMutation = async (request: () => Promise<void>) => {
    setError(null);
    try {
      await mutation.run(request);
      await overviewQuery.refetch();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const createInvitation = () =>
    refreshAfterMutation(async () => {
      setCreatedInvitation(await api.createInvitation());
      showToast("Invite created");
    });

  const replaceInvitation = (id: string) =>
    refreshAfterMutation(async () => {
      setCreatedInvitation(await api.createInvitation(id));
      showToast("Invite replaced");
    });

  const revokeInvitation = (id: string) =>
    refreshAfterMutation(async () => {
      await api.revokeInvitation(id);
      if (createdInvitation?.id === id) setCreatedInvitation(null);
      showToast("Invite revoked");
    });

  const copyCreatedInvitation = async (value: string, confirmation: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showToast(confirmation);
    } catch {
      setError("Could not copy. Select and copy the code below.");
    }
  };

  if (!overview)
    return error || overviewQuery.error ? (
      <p className="login-error" role="alert">
        {error ?? errorMessage(overviewQuery.error)}
      </p>
    ) : null;
  if (!overview.enabled) return null;
  const hasActiveInvitation = overview.invitations.some(
    (invitation) => invitationStatus(invitation) === "Available",
  );
  const canCreate =
    overview.allowance.kind === "unlimited" ||
    (overview.allowance.remaining > 0 && !hasActiveInvitation);

  return (
    <section className="settings-section" aria-labelledby="invitations-heading" aria-busy={busy}>
      <div className="settings-heading">
        <h2 id="invitations-heading">Invites</h2>
        <p>
          {overview.allowance.kind === "unlimited"
            ? "Invite as many people as you like. Each invite can be used once."
            : overview.allowance.remaining === 0
              ? "Your invite was used. Its recipient now has an invite to share."
              : "Invite one person. They’ll get an invite of their own."}
        </p>
      </div>
      <div className="account-setting-block">
        {canCreate ? (
          <div className="settings-item-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => void createInvitation()}
            >
              Create invite
            </button>
          </div>
        ) : null}
        {createdInvitation ? (
          <div className="invitation-share" role="status">
            <label className="login-field" htmlFor="created-invite-code">
              <span>Invite code</span>
              <input
                id="created-invite-code"
                value={createdInvitation.code}
                readOnly
                onFocus={(event) => event.target.select()}
              />
            </label>
            <div className="settings-item-actions">
              <button
                type="button"
                className="primary-button"
                onClick={() =>
                  void copyCreatedInvitation(
                    new URL(`${appUrl("/join")}#${createdInvitation.code}`, window.location.origin)
                      .href,
                    "Invite link copied",
                  )
                }
              >
                Copy invite link
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() =>
                  void copyCreatedInvitation(createdInvitation.code, "Invite code copied")
                }
              >
                Copy code
              </button>
            </div>
            <p className="account-setting-note">
              Copy it now. If you lose the code, you can replace an unused invite. Invites expire
              after {INVITE_EXPIRATION_DAYS} days.
            </p>
          </div>
        ) : null}
        {overview.invitations.length ? (
          <ul className="settings-item-list invitation-list">
            {overview.invitations.map((invitation) => {
              const status = invitationStatus(invitation);
              return (
                <li key={invitation.id}>
                  <div className="settings-item-copy">
                    <strong>Invite {invitation.number}</strong>
                    <p>
                      {status} · {status === "Available" ? "Expires" : "Created"}{" "}
                      {new Date(
                        status === "Available" ? invitation.expiresAt : invitation.createdAt,
                      ).toLocaleDateString()}
                    </p>
                  </div>
                  {status === "Available" ? (
                    <div className="settings-item-actions">
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        aria-label={`Replace invite ${invitation.number}`}
                        onClick={() => void replaceInvitation(invitation.id)}
                      >
                        Replace
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        disabled={busy}
                        aria-label={`Revoke invite ${invitation.number}`}
                        onClick={() => void revokeInvitation(invitation.id)}
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
      {error ? (
        <p className="login-error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
