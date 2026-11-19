const WINDOWS_PATH = /\b[A-Za-z]:[\\/](?:[^\s"<>|]+[\\/])*[^\s"<>|]*/g;
const UNC_PATH = /\\\\[^\s\\/"'<>|]+[\\/][^\s"'<>|]+/g;
const POSIX_PATH =
  /(?<![\w:/])\/(?:Users|home|tmp|private|var|mnt|Volumes|root|workspace|opt|etc|usr)\/(?:[A-Za-z0-9._~-]+\/)*[A-Za-z0-9._~-]+/g;
/** Prevent desktop filesystem locations from leaving the computer in summaries or transcripts. */
export function sanitizeRemoteText(value: string): string {
  return value
    .replace(UNC_PATH, "[local path]")
    .replace(WINDOWS_PATH, "[local path]")
    .replace(POSIX_PATH, "[local path]");
}
