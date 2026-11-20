import { UserCircle } from "@phosphor-icons/react";
import { useState } from "react";
import type { AccountProfile } from "../../../../shared/remote";
import { useT } from "../../../hooks/useT";
import styles from "../MobilePairingPanel.module.css";

/** Avatar failure only affects presentation; account credentials stay in the main process. */
export function RemoteAccountIdentity({
  profile,
  accountId,
}: {
  profile: AccountProfile | null;
  accountId: string | null;
}) {
  const t = useT();
  const [failedPicture, setFailedPicture] = useState<string | null>(null);
  const picture = profile?.picture;
  return (
    <div className={styles.accountIdentity}>
      <span className={styles.accountAvatar} aria-hidden="true">
        {picture && picture !== failedPicture ? (
          <img
            src={picture}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setFailedPicture(picture)}
          />
        ) : (
          <UserCircle size={24} weight="regular" />
        )}
      </span>
      <div data-selectable-text>
        <p>{profile?.name ?? t("settings.remote.savedAccount")}</p>
        <p className={styles.hint}>
          {profile?.subject ?? accountId ?? t("settings.remote.identityUnavailable")}
        </p>
      </div>
    </div>
  );
}
