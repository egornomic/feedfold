import type { ApiOutput, PasskeySummary } from "../shared/api/operations.js";
import type { InvitationSummary } from "../shared/types.js";
import type { DataMode } from "./worst-case.js";

interface StressAccount {
  session: ApiOutput<"session">;
  authConfig: ApiOutput<"authConfig">;
  passkeys: ApiOutput<"passkeys">;
  invitations: ApiOutput<"invitations">;
}

function daysFrom(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString();
}

function passkey(index: number, now: Date): PasskeySummary {
  // Renamed passkeys accept 80 characters; these are display records, with no key material.
  const names = [
    "MacBook Pro — Aleksandra Wiśniewska-Kowalczyk — research, travel and backup access for field work".slice(
      0,
      80,
    ),
    "Jo",
    "Đặng Thị Ngọc Hân — workstation",
    "王秀英 — 同步通行密钥",
    "نور الهدى عبد الرحمن — مفتاح الأمان",
    "👩🏽‍💻 Priya — office laptop",
    "iPhone — travel",
    "iPad — home",
    "Desktop — studio",
    "Security key — primary",
    "Security key — spare",
    "Previous laptop — retained backup",
  ];
  return {
    id: `break-ui-passkey-${index + 1}`,
    name: names[index] ?? `Security key ${index + 1}`,
    createdAt: daysFrom(now, -index * 45),
    lastUsedAt: index === 1 ? null : daysFrom(now, -index * 3),
    deviceType: index % 2 === 0 ? "multiDevice" : "singleDevice",
    backedUp: index % 2 === 0,
  };
}

function invitation(index: number, now: Date): InvitationSummary {
  const state = index % 4;
  const age = index === 0 ? 0 : 40 + index * 3;
  return {
    id: `break-ui-invitation-${index + 1}`,
    number: 1_284 - index,
    createdAt: daysFrom(now, -age),
    expiresAt: daysFrom(now, 30 - age),
    revokedAt: state === 2 ? daysFrom(now, 1 - age) : null,
    redeemedAt: state === 1 ? daysFrom(now, 1 - age) : null,
  };
}

export function createStressAccount(mode: DataMode, now = new Date()): StressAccount {
  if (mode === "demo") {
    return {
      session: { user: { id: "demo", username: "demo", hasPassword: false } },
      authConfig: {
        registrationAvailable: false,
        registrationMode: "closed",
        passkeysAvailable: false,
      },
      passkeys: { passkeys: [], hasPassword: false },
      invitations: {
        enabled: false,
        allowance: { kind: "limited", remaining: 0 },
        invitations: [],
      },
    };
  }

  const passkeyCount = mode === "empty" ? 0 : mode === "one" ? 1 : mode === "huge" ? 12 : 6;
  const invitationCount = mode === "empty" ? 0 : mode === "one" ? 1 : mode === "huge" ? 100 : 4;
  return {
    // Usernames accept 3–32 ASCII letters/numbers/dots/hyphens/underscores.
    session: {
      user: {
        id: "demo",
        username: "aleksandra.wisniewska-kowalczyk2",
        hasPassword: true,
      },
    },
    authConfig: {
      registrationAvailable: true,
      registrationMode: "invite",
      passkeysAvailable: true,
    },
    passkeys: {
      passkeys: Array.from({ length: passkeyCount }, (_, index) => passkey(index, now)),
      hasPassword: true,
    },
    invitations: {
      enabled: true,
      allowance:
        mode === "worst" || mode === "huge"
          ? { kind: "unlimited" }
          : { kind: "limited", remaining: 1 },
      invitations: Array.from({ length: invitationCount }, (_, index) => ({
        ...invitation(index, now),
        number: mode === "one" ? 1 : 1_284 - index,
      })),
    },
  };
}
