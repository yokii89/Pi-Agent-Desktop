import { ArrowsClockwise, DownloadSimple, Plug, Trash } from "@phosphor-icons/react";
import { useState } from "react";
import type { GatewayCatalog, GatewayModelInfo } from "../../../shared/newApi";
import { useT } from "../../hooks/useT";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";
import styles from "./DurableModelSettings.module.css";
import { SettingRow } from "./SettingRow";

interface Props {
  catalog: GatewayCatalog<GatewayModelInfo>;
  modelId: string;
  busy: boolean;
  configured: boolean;
  onSelect(model: GatewayModelInfo): void;
  onRefresh(): void;
  onClear(): void;
  onTest(): void;
  onImport(): void;
}

/** Catalog browsing and maintenance stay separate from the credential editor. */
export function GatewayModelCatalogSettings({
  catalog,
  modelId,
  busy,
  configured,
  onSelect,
  onRefresh,
  onClear,
  onTest,
  onImport,
}: Props) {
  const t = useT();
  const [query, setQuery] = useState("");
  const filtered = catalog.models.filter((model) =>
    `${model.id} ${model.name}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const options = filtered.map((model) => ({
    value: model.id,
    label: model.name,
    hint: model.id === modelId ? t("settings.newapi.preferred") : undefined,
  }));
  return (
    <>
      <div className={styles.actions}>
        <Button onClick={onImport} disabled={busy}>
          <DownloadSimple size={16} />
          {t("settings.newapi.import")}
        </Button>
        <Button onClick={onRefresh} disabled={busy || !configured}>
          <ArrowsClockwise size={16} />
          {t("settings.newapi.refresh")}
        </Button>
        <Button onClick={onTest} disabled={busy || !configured}>
          <Plug size={16} />
          {t("settings.newapi.test")}
        </Button>
        <Button onClick={onClear} disabled={busy || !configured}>
          <Trash size={16} />
          {t("settings.newapi.clear")}
        </Button>
      </div>
      <p className={styles.description} data-selectable-text role="status">
        {t(busy ? "settings.newapi.loading" : "settings.newapi.count", {
          count: catalog.models.length,
        })}
        {catalog.fetchedAt !== null &&
          ` · ${t("settings.newapi.cachedAt", { time: new Date(catalog.fetchedAt).toLocaleString() })}`}
        {catalog.stale && ` · ${t("settings.newapi.stale")}`}
      </p>
      {catalog.error && (
        <p className={styles.description} data-selectable-text role="alert">
          {t("settings.newapi.fallback")} {catalog.error}
        </p>
      )}
      {catalog.models.length > 0 && (
        <>
          <SettingRow
            label={t("settings.newapi.filter")}
            control={
              <input
                className={styles.input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                aria-label={t("settings.newapi.filter")}
              />
            }
          />
          <SettingRow
            label={t("settings.newapi.discovered")}
            description={t("settings.newapi.catalogHint")}
            control={
              <Select
                value={modelId}
                options={options}
                disabled={busy || !options.length}
                placeholder={t("settings.newapi.choose")}
                ariaLabel={t("settings.newapi.discovered")}
                onChange={(id) => {
                  const model = catalog.models.find((row) => row.id === id);
                  if (model) onSelect(model);
                }}
              />
            }
          />
        </>
      )}
    </>
  );
}
