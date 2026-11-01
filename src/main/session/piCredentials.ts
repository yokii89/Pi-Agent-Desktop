import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import type {
  PiAuthProviderStatus,
  PiAuthSnapshot,
  PiAuthUpsertRequest,
  PiImportableProvider,
} from "../../shared/ipc";
import {
  extractSecret,
  isGatewayProvider,
  maskSecret,
  providerLabel,
  pruneAuthToSingleProvider,
  readAuthLenient,
  removeProviderAuth,
  writeProviderAuth,
} from "./piAuth";
import { readDefaultModel, setDefaultModel, setDefaultProviderOnly } from "./piSettings";

/**
 * 命名凭据注册表（PiDesk 侧）：同一 provider 可挂多把 key（公司/个人等），
 * 激活时把对应密钥写入 auth.json 标准键，pi 始终只认一个 provider 一条凭据。
 * 注册表落在 Electron userData，不污染 ~/.pi 的 pi 命名空间。
 */

interface StoredCredential {
  id: string;
  name: string;
  provider: string;
  /**
   * pidesk = PiDesk 创建，激活时重写 auth.json；
   * pi = 从 pi CLI 已有登录继承，激活只切默认 provider，不改写 auth.json。
   */
  origin: "pidesk" | "pi";
  kind: "api_key" | "oauth" | "unknown";
  /** 明文密钥，只存主进程侧文件（0600）。 */
  secret: string | null;
  baseUrl: string | null;
  api: string | null;
  preferredModel: string | null;
  expiresAt: number | null;
}

interface CredentialsFile {
  version: 1;
  credentials: StoredCredential[];
  /** provider → 该厂商下「候选」凭据 id（切换密钥时写 auth.json 用）。 */
  activeByProvider: Record<string, string>;
  /**
   * 全局当前激活的命名凭据 id（权威）。
   * 不依赖 settings.defaultProvider：同名模型 / pi 恢复会话都可能搅动 settings，
   * UI 激活徽标与 auth.json 投影一律以本字段为准。
   */
  activeCredentialId: string | null;
}

const FILENAME = "credentials.json";
const FILE_VERSION = 1 as const;

function registryFile(): string {
  return path.join(app.getPath("userData"), FILENAME);
}

function stripBom(raw: string): string {
  return raw.startsWith("\uFEFF") ? raw.slice(1) : raw;
}

function emptyFile(): CredentialsFile {
  return { version: FILE_VERSION, credentials: [], activeByProvider: {}, activeCredentialId: null };
}

function isStoredCredential(
  value: unknown,
): value is Omit<StoredCredential, "origin"> & { origin?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return typeof r.id === "string" && typeof r.provider === "string";
}

function readRegistryLenient(): CredentialsFile {
  try {
    const raw = fs.readFileSync(registryFile(), "utf8");
    const parsed = JSON.parse(stripBom(raw)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyFile();
    const record = parsed as Partial<CredentialsFile>;
    // 旧注册表没有 origin：默认按 PiDesk 创建处理（与当时行为一致）
    const credentials = (
      Array.isArray(record.credentials) ? record.credentials.filter(isStoredCredential) : []
    ).map(
      (credential): StoredCredential => ({
        ...credential,
        origin: credential.origin === "pi" ? "pi" : "pidesk",
      }),
    );
    const activeByProvider: Record<string, string> = {};
    if (record.activeByProvider && typeof record.activeByProvider === "object") {
      for (const [provider, id] of Object.entries(record.activeByProvider)) {
        if (typeof id === "string" && id) activeByProvider[provider] = id;
      }
    }
    const activeCredentialId =
      typeof record.activeCredentialId === "string" && record.activeCredentialId
        ? record.activeCredentialId
        : null;
    return { version: FILE_VERSION, credentials, activeByProvider, activeCredentialId };
  } catch {
    return emptyFile();
  }
}

function writeRegistry(next: CredentialsFile): void {
  const file = registryFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 });
}

/**
 * 首次运行迁移：把 auth.json 现有条目收编为命名凭据（名称 = 厂商 label）。
 * 之后 auth.json 只是「当前激活凭据」的投影，权威列表在注册表。
 */
function migrateFromAuthJsonIfEmpty(): CredentialsFile {
  const registry = readRegistryLenient();
  if (registry.credentials.length > 0) return registry;

  const auth = readAuthLenient();
  const ids = Object.keys(auth);
  if (ids.length === 0) return registry;

  const { provider: defaultProvider } = readDefaultModel();
  for (const provider of ids) {
    const raw = auth[provider];
    const record =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const type = typeof record.type === "string" ? record.type : null;
    const kind: StoredCredential["kind"] =
      type === "api_key" ? "api_key" : type === "oauth" ? "oauth" : "unknown";
    const baseUrl = typeof record.baseUrl === "string" && record.baseUrl ? record.baseUrl : null;
    const api = typeof record.api === "string" && record.api ? record.api : null;
    const preferredModel =
      typeof record.preferredModel === "string" && record.preferredModel
        ? record.preferredModel
        : null;
    let expiresAt: number | null = null;
    if (typeof record.expires === "number" && Number.isFinite(record.expires)) {
      if (record.expires < Number.MAX_SAFE_INTEGER) expiresAt = record.expires;
    }
    const id = randomUUID();
    registry.credentials.push({
      id,
      name: providerLabel(provider),
      provider,
      // 来自 auth.json = 现有登录属于 pi：只建立引用，不复制密钥、激活时不重写
      origin: "pi",
      kind,
      secret: null,
      baseUrl,
      api,
      preferredModel,
      expiresAt,
    });
    // 每个 provider 只迁一条到候选指针；defaultProvider 命中时优先覆盖
    const already = registry.activeByProvider[provider];
    if (!already || defaultProvider === provider) {
      registry.activeByProvider[provider] = id;
    }
    if (defaultProvider === provider) {
      registry.activeCredentialId = id;
    }
  }
  if (!registry.activeCredentialId && registry.credentials.length > 0) {
    registry.activeCredentialId = registry.credentials[0].id;
  }
  writeRegistry(registry);
  return registry;
}

function asAuthRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function describeAuthRecord(record: Record<string, unknown>): {
  kind: StoredCredential["kind"];
  secret: string | null;
  expiresAt: number | null;
  /** 带 refresh 的 OAuth 由 pi 自动续期，到期不应显示「已过期」。 */
  renewable: boolean;
} {
  const type = typeof record.type === "string" ? record.type : null;
  const kind: StoredCredential["kind"] =
    type === "api_key" ? "api_key" : type === "oauth" ? "oauth" : "unknown";
  const rawExpires =
    typeof record.expires === "number" && Number.isFinite(record.expires) ? record.expires : null;
  const refresh = typeof record.refresh === "string" ? record.refresh.trim() : "";
  return {
    kind,
    secret: extractSecret(record),
    expiresAt: rawExpires !== null && rawExpires < Number.MAX_SAFE_INTEGER ? rawExpires : null,
    renewable: refresh.length > 0,
  };
}

/**
 * 映射为渲染层状态。`active` 只表示「全局当前激活」——
 * 即 settings.defaultProvider 指向的那一条，而不是各 provider 自己的候选指针。
 */
function mapCredential(
  stored: StoredCredential,
  activeCredentialId: string | null,
  live?: Record<string, unknown>,
): PiAuthProviderStatus {
  const active = activeCredentialId !== null && activeCredentialId === stored.id;
  // pi 来源以 auth.json 当前值为准：CLI / 扩展刷新 token 后不显示过期
  const liveFields = stored.origin === "pi" && live ? describeAuthRecord(live) : null;
  const sourceMissing = stored.origin === "pi" && !live;
  const kind = liveFields?.kind ?? stored.kind;
  const secret = liveFields?.secret ?? stored.secret;
  const expiresAt = liveFields ? liveFields.expiresAt : stored.expiresAt;
  const renewable = liveFields?.renewable ?? false;
  const expired = !renewable && expiresAt !== null && expiresAt < Date.now();
  return {
    id: stored.id,
    name: stored.name,
    provider: stored.provider,
    origin: stored.origin,
    kind,
    maskedCredential: sourceMissing ? null : secret ? maskSecret(secret) : null,
    baseUrl: stored.baseUrl,
    api: stored.api,
    preferredModel: stored.preferredModel,
    expiresAt,
    expired,
    sourceMissing,
    active,
  };
}

/** auth.json 中已有、注册表未收录的 provider（只含掩码，供「从 pi 继承」列表）。 */
function listImportableProviders(
  registry: CredentialsFile,
  auth: Record<string, unknown>,
): PiImportableProvider[] {
  const known = new Set(registry.credentials.map((credential) => credential.provider));
  const result: PiImportableProvider[] = [];
  for (const [provider, value] of Object.entries(auth)) {
    if (known.has(provider)) continue;
    const record = asAuthRecord(value);
    if (!record) continue;
    const { kind, secret, expiresAt, renewable } = describeAuthRecord(record);
    result.push({
      provider,
      label: providerLabel(provider),
      kind,
      maskedCredential: secret ? maskSecret(secret) : null,
      expiresAt,
      expired: !renewable && expiresAt !== null && expiresAt < Date.now(),
    });
  }
  return result.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * 解析全局激活凭据。权威是 `activeCredentialId`（用户点过「激活」的那条）；
 * 仅在字段缺失/失效时回退 defaultProvider → 第一条，避免同名模型场景被 settings 带偏。
 */
function resolveActiveProvider(registry: CredentialsFile): {
  activeProvider: string | null;
  activeCredentialId: string | null;
} {
  if (registry.activeCredentialId) {
    const hit = registry.credentials.find((c) => c.id === registry.activeCredentialId);
    if (hit) return { activeProvider: hit.provider, activeCredentialId: hit.id };
  }
  const { provider } = readDefaultModel();
  if (provider) {
    const activeId = registry.activeByProvider[provider];
    if (activeId) {
      const hit = registry.credentials.find((c) => c.id === activeId);
      if (hit) return { activeProvider: hit.provider, activeCredentialId: hit.id };
    }
    const fallback = registry.credentials.find((c) => c.provider === provider);
    if (fallback) return { activeProvider: fallback.provider, activeCredentialId: fallback.id };
  }
  const first = registry.credentials[0];
  if (!first) return { activeProvider: null, activeCredentialId: null };
  const candidateId = registry.activeByProvider[first.provider] ?? first.id;
  const candidate = registry.credentials.find((c) => c.id === candidateId) ?? first;
  return { activeProvider: candidate.provider, activeCredentialId: candidate.id };
}

function toSnapshot(registry: CredentialsFile): PiAuthSnapshot {
  const { activeProvider, activeCredentialId } = resolveActiveProvider(registry);
  const auth = readAuthLenient();
  const providers = registry.credentials.map((credential) =>
    mapCredential(
      credential,
      activeCredentialId,
      asAuthRecord(auth[credential.provider]) ?? undefined,
    ),
  );
  return {
    providers,
    importable: listImportableProviders(registry, auth),
    activeProvider,
    activeCredentialId,
    file: registryFile(),
  };
}

function findCredential(registry: CredentialsFile, id: string): StoredCredential {
  const found = registry.credentials.find((c) => c.id === id);
  if (!found) throw new Error(`未找到凭据：${id}`);
  return found;
}

/**
 * 把 auth.json 中已有、注册表未收录的 provider 导入为 origin=pi 的凭据。
 * 不写 auth.json、不自动激活；之后可像普通凭据一样切换。
 */
export function importProvider(provider: string): PiAuthSnapshot {
  const providerId = provider.trim();
  if (!providerId) throw new Error("provider 不能为空");
  const registry = migrateFromAuthJsonIfEmpty();
  if (registry.credentials.some((credential) => credential.provider === providerId)) {
    throw new Error(`该 provider 已在凭据列表中：${providerId}`);
  }
  const record = asAuthRecord(readAuthLenient()[providerId]);
  if (!record) throw new Error(`pi 登录文件中没有该 provider：${providerId}`);
  const { kind, expiresAt } = describeAuthRecord(record);

  const target: StoredCredential = {
    id: randomUUID(),
    name: providerLabel(providerId),
    provider: providerId,
    origin: "pi",
    kind,
    // 只建立引用：密钥始终从 auth.json 现读，不在 PiDesk 注册表留第二份
    secret: null,
    baseUrl: typeof record.baseUrl === "string" && record.baseUrl ? record.baseUrl : null,
    api: typeof record.api === "string" && record.api ? record.api : null,
    preferredModel: null,
    expiresAt,
  };
  const next: CredentialsFile = {
    ...registry,
    credentials: [...registry.credentials, target],
  };
  writeRegistry(next);
  return toSnapshot(next);
}

function applyToAuthJson(stored: StoredCredential): void {
  writeProviderAuth(stored.provider, {
    kind: stored.kind,
    secret: stored.secret,
    baseUrl: stored.baseUrl,
    api: stored.api,
    preferredModel: stored.preferredModel,
    expiresAt: stored.expiresAt,
  });
}

/**
 * 投影激活凭据到 auth.json，并清掉注册表里其它「PiDesk 创建」厂商的键（防止模型列表混入）。
 * origin=pi 的凭据由 pi / 扩展自己维护，永不在这里写入或清理。
 */
function projectActiveToAuthJson(stored: StoredCredential, registry: CredentialsFile): void {
  if (stored.origin === "pi") return;
  applyToAuthJson(stored);
  pruneAuthToSingleProvider(
    stored.provider,
    registry.credentials
      .filter((credential) => credential.origin !== "pi")
      .map((credential) => credential.provider),
  );
}

/** 列出命名凭据（掩码）。顺带把 auth.json 钉回激活项，清理历史双键残留。 */
export function listCredentials(): PiAuthSnapshot {
  const registry = migrateFromAuthJsonIfEmpty();
  // 旧文件没有 activeCredentialId：首次读取时按当前解析结果固化，避免之后被 settings 带偏
  if (!registry.activeCredentialId) {
    const { activeCredentialId } = resolveActiveProvider(registry);
    if (activeCredentialId) {
      const next = { ...registry, activeCredentialId };
      writeRegistry(next);
      reassertFromRegistry(next);
      return toSnapshot(next);
    }
  }
  reassertFromRegistry(registry);
  return toSnapshot(registry);
}

function reassertFromRegistry(registry: CredentialsFile): void {
  const { activeCredentialId } = resolveActiveProvider(registry);
  if (!activeCredentialId) return;
  const target = registry.credentials.find((c) => c.id === activeCredentialId);
  if (!target) return;
  projectActiveToAuthJson(target, registry);
}

/** 新增 / 更新命名凭据；更新且为当前激活项时同步 auth.json。 */
export function upsertCredential(req: PiAuthUpsertRequest): PiAuthSnapshot {
  const name = req.name?.trim() ?? "";
  if (!name) throw new Error("请填写凭据名称");
  const provider = req.provider?.trim() ?? "";
  if (!provider) throw new Error("provider 不能为空");
  const apiKey = req.apiKey?.trim() ?? "";
  const registry = migrateFromAuthJsonIfEmpty();
  const existingId = req.id?.trim() || null;
  const existing = existingId ? findCredential(registry, existingId) : null;
  if (existing?.origin === "pi") {
    throw new Error("从 pi 继承的凭据不支持在 PiDesk 内编辑；请到 pi 侧修改登录");
  }

  if (!existing && !apiKey) {
    throw new Error("新增凭据必须提供 API Key");
  }
  if (apiKey && apiKey.length < 8) {
    throw new Error("API Key 过短，请检查是否完整粘贴");
  }

  const gateway = isGatewayProvider(provider);
  const baseUrlRaw = req.baseUrl?.trim() ?? "";
  if (gateway && !existing && !baseUrlRaw) {
    throw new Error("New API 必须填写 Base URL");
  }

  const next: CredentialsFile = {
    ...registry,
    credentials: [...registry.credentials],
    activeByProvider: { ...registry.activeByProvider },
    activeCredentialId: registry.activeCredentialId,
  };

  let target: StoredCredential;
  if (existing) {
    const index = next.credentials.findIndex((c) => c.id === existing.id);
    if (index < 0) throw new Error(`未找到凭据：${existing.id}`);
    const kind: StoredCredential["kind"] = gateway ? "oauth" : apiKey ? "api_key" : existing.kind;
    target = {
      ...existing,
      name,
      // 允许改 provider（相当于换挂载点）；激活同步时按新 provider 写
      provider,
      kind,
      secret: apiKey || existing.secret,
      baseUrl: gateway
        ? baseUrlRaw
          ? baseUrlRaw.replace(/\/+$/, "").replace(/\/v1\/?$/i, "")
          : existing.baseUrl
        : existing.baseUrl,
      api: gateway
        ? req.api !== undefined && req.api !== null
          ? req.api
          : (existing.api ?? "openai-completions")
        : existing.api,
      preferredModel:
        req.preferredModel !== undefined && req.preferredModel !== null
          ? req.preferredModel.trim() || null
          : existing.preferredModel,
    };
    next.credentials[index] = target;
    // provider 变更时清理旧候选指针；auth.json 只投影全局激活项，这里只摘掉旧键
    if (
      existing.provider !== provider &&
      next.activeByProvider[existing.provider] === existing.id
    ) {
      delete next.activeByProvider[existing.provider];
      const remain = next.credentials.find((c) => c.provider === existing.provider);
      if (remain) next.activeByProvider[existing.provider] = remain.id;
      removeProviderAuth(existing.provider);
    }
  } else {
    const kind: StoredCredential["kind"] = gateway ? "oauth" : "api_key";
    target = {
      id: randomUUID(),
      name,
      provider,
      origin: "pidesk",
      kind,
      secret: apiKey,
      baseUrl: gateway ? baseUrlRaw.replace(/\/+$/, "").replace(/\/v1\/?$/i, "") : null,
      api: gateway ? req.api?.trim() || "openai-completions" : null,
      preferredModel: req.preferredModel?.trim() || null,
      expiresAt: null,
    };
    next.credentials.push(target);
  }

  // 该 provider 尚无候选项：新建/更新后立即设为候选
  const activeId = next.activeByProvider[target.provider];
  const activeStillValid = activeId
    ? next.credentials.some((c) => c.id === activeId && c.provider === target.provider)
    : false;
  if (!activeStillValid) {
    next.activeByProvider[target.provider] = target.id;
  }
  // 首条凭据：直接成为全局激活项，避免 UI 落到「无激活」再回退到错误条目
  if (!next.activeCredentialId) {
    next.activeCredentialId = target.id;
  }

  writeRegistry(next);
  // 只有「全局激活项」才投影到 auth.json，避免非激活厂商的键残留导致模型列表混入
  const { activeCredentialId } = resolveActiveProvider(next);
  if (activeCredentialId === target.id) {
    projectActiveToAuthJson(target, next);
  }
  return toSnapshot(next);
}

/** 移除命名凭据；若为激活项则同 provider 下一条顶上或清掉 auth.json 键。 */
export function removeCredential(id: string): PiAuthSnapshot {
  const credId = id.trim();
  if (!credId) throw new Error("凭据 id 不能为空");
  const registry = migrateFromAuthJsonIfEmpty();
  const target = findCredential(registry, credId);
  const next: CredentialsFile = {
    ...registry,
    credentials: registry.credentials.filter((c) => c.id !== credId),
    activeByProvider: { ...registry.activeByProvider },
    activeCredentialId: registry.activeCredentialId === credId ? null : registry.activeCredentialId,
  };

  const wasCandidate = next.activeByProvider[target.provider] === credId;
  if (wasCandidate) {
    const remain = next.credentials.find((c) => c.provider === target.provider);
    if (remain) {
      next.activeByProvider[target.provider] = remain.id;
    } else {
      delete next.activeByProvider[target.provider];
      // 继承条目只解除 PiDesk 侧引用，auth.json 归 pi / 扩展所有
      if (target.origin !== "pi") removeProviderAuth(target.provider);
    }
  }

  // 删掉的是全局激活项：顶上同厂商候选，否则顶上第一条
  if (!next.activeCredentialId) {
    const sameProvider = next.credentials.find((c) => c.provider === target.provider);
    const promoted = sameProvider ?? next.credentials[0] ?? null;
    if (promoted) {
      next.activeCredentialId = promoted.id;
      next.activeByProvider[promoted.provider] = promoted.id;
    }
  }

  // defaultProvider 与 auth.json 对齐到新的全局激活项
  const { provider: currentDefault, modelId: currentModel } = readDefaultModel();
  const { activeCredentialId } = resolveActiveProvider(next);
  const activeCred = activeCredentialId
    ? next.credentials.find((c) => c.id === activeCredentialId)
    : null;
  if (activeCred) {
    try {
      const preferred = activeCred.preferredModel?.trim();
      if (preferred) {
        setDefaultModel(activeCred.provider, preferred);
      } else if (currentDefault === activeCred.provider && currentModel) {
        setDefaultModel(activeCred.provider, currentModel);
      } else {
        setDefaultProviderOnly(activeCred.provider);
      }
      projectActiveToAuthJson(activeCred, next);
    } catch {
      // settings 损坏时只完成删除
    }
  }

  writeRegistry(next);
  return toSnapshot(next);
}

/**
 * 激活命名凭据：写 auth.json 标准键 + settings defaultProvider/defaultModel，
 * 并把 `activeCredentialId` 记为权威激活项。同 provider 多把 key 的切换全部走这里。
 */
export function activateCredential(id: string): PiAuthSnapshot {
  const credId = id.trim();
  if (!credId) throw new Error("凭据 id 不能为空");
  const registry = migrateFromAuthJsonIfEmpty();
  const target = findCredential(registry, credId);

  const next: CredentialsFile = {
    ...registry,
    credentials: [...registry.credentials],
    activeByProvider: { ...registry.activeByProvider, [target.provider]: target.id },
    activeCredentialId: target.id,
  };

  const preferred = target.preferredModel?.trim();
  const { provider: currentProvider, modelId: currentModel } = readDefaultModel();

  projectActiveToAuthJson(target, next);
  if (preferred) {
    setDefaultModel(target.provider, preferred);
  } else if (currentProvider === target.provider && currentModel) {
    // 同厂商换 key：沿用当前模型（同名模型场景下 settings 字段可能完全不变）
    setDefaultModel(target.provider, currentModel);
  } else {
    // 跨厂商且无偏好模型：只切 defaultProvider，不把 model 写成 provider id
    setDefaultProviderOnly(target.provider);
  }
  writeRegistry(next);
  return toSnapshot(next);
}

/**
 * 在 set_model / 会话恢复之后，用注册表里的激活凭据再对齐一次 settings 与 auth.json。
 * 防止 pi 会话恢复或同名模型场景把 defaultProvider 悄悄写回旧厂商。
 */
export function reassertActiveCredential(): void {
  const registry = migrateFromAuthJsonIfEmpty();
  const { activeCredentialId } = resolveActiveProvider(registry);
  if (!activeCredentialId) return;
  const target = registry.credentials.find((c) => c.id === activeCredentialId);
  if (!target) return;
  projectActiveToAuthJson(target, registry);
  const preferred = target.preferredModel?.trim();
  const { provider: currentProvider, modelId: currentModel } = readDefaultModel();
  if (preferred) {
    if (currentProvider !== target.provider || currentModel !== preferred) {
      setDefaultModel(target.provider, preferred);
    }
  } else if (currentProvider !== target.provider) {
    setDefaultProviderOnly(target.provider);
  }
}

/**
 * 把用户刚选中的模型回写到「当前全局激活」凭据的 preferredModel，
 * 保证下次激活该凭据时能直接落到同一模型，而不是退回 provider id。
 */
export function syncPreferredModelForActive(provider: string, modelId: string): void {
  const providerId = provider.trim();
  const model = modelId.trim();
  if (!providerId || !model) return;
  const registry = migrateFromAuthJsonIfEmpty();
  const { activeProvider, activeCredentialId } = resolveActiveProvider(registry);
  if (activeProvider !== providerId || !activeCredentialId) return;
  const index = registry.credentials.findIndex((c) => c.id === activeCredentialId);
  if (index < 0) return;
  if (registry.credentials[index].preferredModel === model) return;
  const credentials = [...registry.credentials];
  credentials[index] = { ...credentials[index], preferredModel: model };
  writeRegistry({ ...registry, credentials });
}
