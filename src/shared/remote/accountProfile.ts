/** Display metadata from an authenticated OIDC /userinfo response; never an authorization source. */
export interface AccountProfile {
  subject: string;
  name: string;
  picture: string | null;
}

function pictureUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Keep only bounded display fields, with a nickname fallback and an optional HTTPS avatar. */
export function parseAccountProfile(value: unknown): AccountProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const profile = value as Record<string, unknown>;
  if (typeof profile.sub !== "string" || !profile.sub.trim() || profile.sub.length > 256)
    return null;
  const name = [profile.name, profile.nickname, profile.sub].find(
    (candidate): candidate is string => typeof candidate === "string" && !!candidate.trim(),
  );
  return {
    subject: profile.sub,
    name: (name ?? profile.sub).trim().slice(0, 256),
    picture: pictureUrl(profile.picture),
  };
}
