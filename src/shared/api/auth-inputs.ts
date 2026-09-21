import { z } from "zod";
import {
  INVITE_CODE_INPUT_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  USERNAME_PATTERN,
} from "../auth.js";

const username = z
  .string()
  .trim()
  .min(USERNAME_MIN_LENGTH, `Use at least ${USERNAME_MIN_LENGTH} characters for the username.`)
  .max(USERNAME_MAX_LENGTH, `Use no more than ${USERNAME_MAX_LENGTH} characters for the username.`)
  .regex(
    USERNAME_PATTERN,
    "Use letters, numbers, dots, hyphens, or underscores; start and end with a letter or number.",
  );
const loginUsername = z.string().trim().min(1).max(80);
const password = z
  .string()
  .min(15, "Use at least 15 characters for the password.")
  .max(128, "Use no more than 128 characters for the password.");
const loginCredentials = z.object({
  username: loginUsername,
  password: z.string().min(1).max(128),
});
const inviteCode = z.string().max(INVITE_CODE_INPUT_MAX_LENGTH).optional();
const registrationCredentials = z.object({ username, password, inviteCode });
const passkeySignup = z.object({ username, inviteCode });
const passwordCredential = z.object({ password });
const ceremonyId = z.string().min(32).max(128);
const operationId = z.string().min(32).max(128);
const passkeyResponse = z
  .object({
    id: z.string().min(1).max(2_048),
    rawId: z.string().min(1).max(2_048),
    response: z.object({}).passthrough(),
    type: z.literal("public-key"),
    clientExtensionResults: z.object({}).passthrough(),
  })
  .passthrough();
const passkeyCeremony = z.object({ ceremonyId, response: passkeyResponse });
const passkeySignupCeremony = z.object({ registrationId: operationId, response: passkeyResponse });
const stepUpPassword = z.object({ operationId, password: z.string().min(1).max(128) });
const stepUpOptions = z.object({ operationId });
const passkeyId = z.string().min(1).max(2_048);
const passkeyRename = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name for the passkey.")
    .max(80, "Use no more than 80 characters for the passkey name."),
});

export const authInputs = {
  username,
  loginUsername,
  password,
  loginCredentials,
  inviteCode,
  registrationCredentials,
  passkeySignup,
  passwordCredential,
  ceremonyId,
  operationId,
  passkeyResponse,
  passkeyCeremony,
  passkeySignupCeremony,
  stepUpPassword,
  stepUpOptions,
  passkeyId,
  passkeyRename,
};
