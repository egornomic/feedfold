export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 32;
export const USERNAME_PATTERN_SOURCE = "[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?";
export const USERNAME_PATTERN = new RegExp(`^${USERNAME_PATTERN_SOURCE}$`);

export const INVITE_CODE_LENGTH = 6;
export const INVITE_CODE_INPUT_MAX_LENGTH = 32;
export const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const INVITE_EXPIRATION_DAYS = 30;
export const INVITE_CODE_PATTERN_SOURCE = `[${INVITE_CODE_ALPHABET}${INVITE_CODE_ALPHABET.toLowerCase()}]{${INVITE_CODE_LENGTH}}`;
export const INVITE_EXPIRATION_MS = INVITE_EXPIRATION_DAYS * 24 * 60 * 60_000;

export function normalizeInviteCode(value: string | undefined): string {
  return value?.replaceAll("-", "").trim().toUpperCase() ?? "";
}

export function isValidUsername(value: string): boolean {
  const username = value.trim();
  return (
    username.length >= USERNAME_MIN_LENGTH &&
    username.length <= USERNAME_MAX_LENGTH &&
    USERNAME_PATTERN.test(username)
  );
}
