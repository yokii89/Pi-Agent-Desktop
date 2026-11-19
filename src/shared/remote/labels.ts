export const pairingMessages = {
  "remote.error.ACCOUNT_AUTH_REQUIRED": {
    "zh-CN": "请先登录此中转的账号。",
    "en-US": "Sign in to your account for this relay first.",
  },
  "remote.error.ACCOUNT_CHANGED": {
    "zh-CN": "账号会话已更改，请重新连接。",
    "en-US": "The account session changed. Connect again.",
  },
  "remote.error.ACCOUNT_CLOSED": {
    "zh-CN": "此账号已关闭或正在撤销。",
    "en-US": "This account is closed or being revoked.",
  },
  "remote.error.REGISTRATION_PENDING": {
    "zh-CN": "登记结果待核对。请保留原请求，在账号设备目录检查状态；不要重复创建电脑。",
    "en-US":
      "Registration needs reconciliation. Keep the original request and check your account directory before creating another computer.",
  },
  "remote.error.REGISTRATION_CREDENTIAL_LOST": {
    "zh-CN": "该电脑已登记，但凭证未能安全恢复。请在账号设备目录移除此登记，再重新登记。",
    "en-US":
      "The computer is registered but its credential cannot be recovered. Remove this registration from your account directory, then register again.",
  },
  "remote.title": { "zh-CN": "手机配对", "en-US": "Mobile pairing" },
  "remote.description": {
    "zh-CN": "电脑始终保留项目与会话控制权；配对时选择允许手机读取的项目。",
    "en-US":
      "Your computer remains authoritative. Choose which projects the phone may read when pairing.",
  },
  "remote.origin": { "zh-CN": "中转 HTTPS origin", "en-US": "Relay HTTPS origin" },
  "remote.trust": {
    "zh-CN": "我信任此中转并确认完整域名",
    "en-US": "I trust this relay and have checked its full domain",
  },
  "remote.trustBody": {
    "zh-CN":
      "此配置使用 HTTPS/WSS，没有端到端加密。中转可读取传输正文并冒充设备。仅连接你信任的自部署中转。",
    "en-US":
      "This profile uses HTTPS/WSS without end-to-end encryption. The relay can read content and impersonate devices. Use only a self-hosted relay you trust.",
  },
  "remote.connect": { "zh-CN": "连接中转", "en-US": "Connect relay" },
  "remote.disconnect": { "zh-CN": "暂停远程连接", "en-US": "Pause remote connection" },
  "remote.createInvitation": { "zh-CN": "生成配对二维码", "en-US": "Create pairing QR code" },
  "remote.expires": { "zh-CN": "有效期至", "en-US": "Valid until" },
  "remote.scan": { "zh-CN": "扫描电脑二维码", "en-US": "Scan desktop QR code" },
  "remote.cameraPermission": {
    "zh-CN": "允许使用相机后扫描电脑端生成的配对二维码。",
    "en-US": "Allow camera access to scan the pairing QR code on your desktop.",
  },
  "remote.deviceName": { "zh-CN": "手机显示名称", "en-US": "Phone display name" },
  "remote.selfReported": {
    "zh-CN": "名称由手机自报，不能证明设备所有权。",
    "en-US": "The phone supplies this name; it does not prove ownership.",
  },
  "remote.confirmation": { "zh-CN": "双端核对码", "en-US": "Comparison code" },
  "remote.confirmationHint": {
    "zh-CN":
      "请在两端核对域名与 8 位数字；一致后在电脑选择项目并同意。扫码和核对码本身不代表授权。",
    "en-US":
      "Compare the domain and all 8 digits on both devices. Then choose projects and approve on your desktop. Scanning and the code alone do not authorize access.",
  },
  "remote.projects": {
    "zh-CN": "允许访问的项目（最多 20 个）",
    "en-US": "Projects allowed (up to 20)",
  },
  "remote.capabilities": {
    "zh-CN": "手机能力（单独授权）",
    "en-US": "Phone capabilities (granted individually)",
  },
  "remote.scope.projects.read": { "zh-CN": "读取项目列表", "en-US": "Read project list" },
  "remote.scope.sessions.read": { "zh-CN": "读取会话与历史", "en-US": "Read sessions and history" },
  "remote.scope.sessions.send": { "zh-CN": "发送消息", "en-US": "Send messages" },
  "remote.scope.sessions.stop": { "zh-CN": "停止运行中的任务", "en-US": "Stop running tasks" },
  "remote.scope.sessions.create": { "zh-CN": "新建会话", "en-US": "Create sessions" },
  "remote.scope.interactions.read": {
    "zh-CN": "查看待处理交互",
    "en-US": "View pending interactions",
  },
  "remote.scope.interactions.answer": {
    "zh-CN": "回答待处理交互",
    "en-US": "Answer pending interactions",
  },
  "remote.approve": {
    "zh-CN": "核对一致，授予所选能力",
    "en-US": "Codes match: grant selected capabilities",
  },
  "remote.reject": { "zh-CN": "拒绝此设备", "en-US": "Reject device" },
  "remote.revoke": { "zh-CN": "撤销手机授权", "en-US": "Revoke phone access" },
  "remote.revokeConfirm": {
    "zh-CN": "撤销后立即阻止此设备访问；恢复访问需要重新配对。",
    "en-US": "Revocation blocks this device immediately. Pair again to restore access.",
  },
  "remote.revocationPending": {
    "zh-CN": "电脑已撤销，中转待同步",
    "en-US": "Revoked on desktop; relay sync pending",
  },
  "remote.revoked": { "zh-CN": "两端均已撤销", "en-US": "Revoked on both sides" },
  "remote.active": { "zh-CN": "已配对", "en-US": "Paired" },
  "remote.prepared": {
    "zh-CN": "已同意，等待手机保存与双端激活",
    "en-US": "Approved; waiting for secure storage and activation",
  },
  "remote.offline": { "zh-CN": "已配对，电脑离线", "en-US": "Paired; desktop offline" },
  "remote.online": { "zh-CN": "已在线", "en-US": "Online" },
  "remote.notPaired": { "zh-CN": "未配对", "en-US": "Not paired" },
  "remote.unpair": { "zh-CN": "撤销并解除配对", "en-US": "Revoke and unpair" },
  "remote.localClear": { "zh-CN": "仅清除此手机的数据", "en-US": "Clear only this phone" },
  "remote.localClearWarning": {
    "zh-CN": "本机清除不会撤销电脑授权。请在电脑上撤销旧手机；清除后不保留可供稍后撤销的凭证。",
    "en-US":
      "Local clearing does not revoke desktop access. Revoke the old phone on your desktop; no credential is retained for a later revoke.",
  },
  "remote.confirm": { "zh-CN": "确认连接此中转", "en-US": "Confirm this relay" },
  "remote.cancel": { "zh-CN": "取消配对", "en-US": "Cancel pairing" },
  "remote.retry": { "zh-CN": "重新扫码", "en-US": "Scan again" },
  "remote.readOnly": {
    "zh-CN": "手机只能使用电脑明确授权的能力；所有操作仍由电脑本地校验。",
    "en-US":
      "The phone can use only capabilities explicitly granted by the desktop; every action is checked locally.",
  },
  "remote.noAnswerPermission": {
    "zh-CN": "当前设备没有回答交互的授权，请在电脑端检查设备权限。",
    "en-US":
      "This device is not allowed to answer interactions. Check permissions on your desktop.",
  },
  "remote.operationPending": {
    "zh-CN": "有 {count} 项操作结果待核对。已连接时会向电脑查询；核对完成前请勿重复提交。",
    "en-US":
      "{count} operation(s) need reconciliation. The app will query the desktop when connected; do not resubmit until checked.",
  },
  "remote.operationUncertain": {
    "zh-CN": "电脑记录显示操作可能已执行，但结果尚不确定。请先检查会话，不要再次发送。",
    "en-US":
      "The desktop cannot confirm whether the operation took effect. Check the session before sending again.",
  },
  "remote.operationNotFound": {
    "zh-CN": "电脑没有找到该操作记录。请检查会话当前状态后再决定是否重试。",
    "en-US":
      "No record was found on the desktop. Check the current session before deciding whether to retry.",
  },
  "remote.operationFailed": {
    "zh-CN": "电脑确认该操作失败。请检查会话当前状态。",
    "en-US": "The desktop confirmed the operation failed. Check the current session.",
  },
  "remote.openTasks": {
    "zh-CN": "查看授权项目和会话",
    "en-US": "View authorized projects and sessions",
  },
  "remote.phase_unpaired": { "zh-CN": "未配对", "en-US": "Not paired" },
  "remote.phase_confirm_origin": {
    "zh-CN": "请确认中转域名与安全边界",
    "en-US": "Confirm relay domain and trust boundary",
  },
  "remote.phase_claiming": { "zh-CN": "正在认领邀请", "en-US": "Claiming invitation" },
  "remote.phase_waiting": {
    "zh-CN": "等待电脑核对并同意",
    "en-US": "Waiting for desktop approval",
  },
  "remote.phase_saving": { "zh-CN": "正在安全保存凭证", "en-US": "Saving credentials securely" },
  "remote.phase_activating": {
    "zh-CN": "等待双端激活确认",
    "en-US": "Waiting for activation on both devices",
  },
  "remote.phase_paired_offline": {
    "zh-CN": "已配对，电脑离线或尚未连接",
    "en-US": "Paired; desktop offline or not connected",
  },
  "remote.phase_connecting": { "zh-CN": "正在连接", "en-US": "Connecting" },
  "remote.phase_online": { "zh-CN": "已在线", "en-US": "Online" },
  "remote.phase_repair_required": {
    "zh-CN": "需要重新配对，请在电脑核对旧授权",
    "en-US": "Pair again; check the old grant on your desktop",
  },
  "remote.phase_cleared_local": {
    "zh-CN": "仅本机数据已清除，电脑授权未撤销",
    "en-US": "Local data cleared; desktop authorization not revoked",
  },
  "remote.error_generic": {
    "zh-CN": "操作未完成，请检查连接与电脑上的授权状态。",
    "en-US":
      "Operation did not complete. Check the connection and the authorization on your desktop.",
  },
  "remote.error.SECURE_STORAGE_UNAVAILABLE": {
    "zh-CN": "安全存储不可用，真实连接已禁用。请使用原生开发构建；不会明文保存凭证。",
    "en-US":
      "Secure storage is unavailable. Real connections are disabled. Use a native development build; credentials are never saved in plaintext.",
  },
  "remote.error.PAIRING_RESULT_UNCERTAIN": {
    "zh-CN": "配对结果待核对。请在电脑撤销旧流程后重新扫码，不要再次兑换凭证。",
    "en-US":
      "Pairing result is uncertain. Revoke the old flow on your desktop and scan again; do not redeem again.",
  },
  "remote.error.AUTH_REFRESH_UNCERTAIN": {
    "zh-CN": "刷新结果不确定，访问已暂停。请在电脑撤销旧设备并重新配对。",
    "en-US":
      "Refresh result is uncertain; access is paused. Revoke the old device on your desktop and pair again.",
  },
  "remote.error.PAIRING_EXPIRED": {
    "zh-CN": "配对已过期，请在电脑重新生成二维码。",
    "en-US": "Pairing expired. Generate a new QR code on your desktop.",
  },
  "remote.error.PAIRING_REJECTED": {
    "zh-CN": "电脑已拒绝配对。",
    "en-US": "Your desktop rejected pairing.",
  },
  "remote.error.PAIRING_UNAVAILABLE": {
    "zh-CN": "此邀请不可用，请在电脑核对并重新生成二维码。",
    "en-US": "This invitation is unavailable. Check your desktop and generate a new QR code.",
  },
  "remote.error.DEVICE_LIMIT_REACHED": {
    "zh-CN": "已有绑定或未完成流程，请先在电脑撤销。",
    "en-US": "A binding or unfinished flow already exists. Revoke it on your desktop first.",
  },
  "remote.error.AUTH_REPLAY_DETECTED": {
    "zh-CN": "检测到刷新凭证再次使用，绑定已撤销。请重新配对。",
    "en-US": "A refresh credential was reused and the binding was revoked. Pair again.",
  },
  "remote.error.DEVICE_REVOKED": {
    "zh-CN": "设备授权已撤销，请重新配对。",
    "en-US": "Device access was revoked. Pair again.",
  },
  "remote.error.AUTH_EXPIRED": {
    "zh-CN": "凭证已到期，请核对电脑登记状态并重新配对。",
    "en-US": "Credentials expired. Check desktop enrollment and pair again.",
  },
  "remote.error.AUTH_REQUIRED": {
    "zh-CN": "需要有效身份，请核对登记或重新配对。",
    "en-US": "A valid identity is required. Check enrollment or pair again.",
  },
  "remote.error.DESKTOP_OFFLINE": {
    "zh-CN": "电脑未连接，无法确认或读取数据。请保持 PiDesk 运行。",
    "en-US": "Desktop is disconnected. Keep PiDesk running to approve or read data.",
  },
  "remote.error.RATE_LIMITED": {
    "zh-CN": "操作过于频繁，正在遵守中转要求等待。",
    "en-US": "Too many requests. Waiting as required by the relay.",
  },
  "remote.error.INVALID_ORIGIN": {
    "zh-CN": "请输入不含路径、参数或账号的完整 HTTPS origin。",
    "en-US": "Enter a full HTTPS origin without a path, query or user information.",
  },
  "remote.error.INVALID_FRAME": {
    "zh-CN": "配对信息格式无效。请扫描电脑生成的新二维码。",
    "en-US": "Invalid pairing data. Scan a fresh QR code from your desktop.",
  },
  "remote.error.RELAY_INSTANCE_MISMATCH": {
    "zh-CN": "中转实例与二维码不一致，已停止连接。",
    "en-US": "Relay instance does not match the QR code. Connection stopped.",
  },
  "remote.error.VERSION_MISMATCH": {
    "zh-CN": "两端控制协议不兼容，请更新应用。",
    "en-US": "Control protocol versions are incompatible. Update both apps.",
  },
  "remote.error.SECURITY_PROFILE_MISMATCH": {
    "zh-CN": "安全配置不兼容或未经确认，已停止连接。",
    "en-US": "Security profile is incompatible or unconfirmed. Connection stopped.",
  },
  "remote.error.IDEMPOTENCY_CONFLICT": {
    "zh-CN": "同一操作对应不同参数，请停止重试并在电脑核对。",
    "en-US": "The same operation has conflicting parameters. Stop retrying and check your desktop.",
  },
  "remote.error.NETWORK_UNCERTAIN": {
    "zh-CN": "网络响应不确定，请核对当前状态；不会自动重试兑换或刷新。",
    "en-US":
      "Network response is uncertain. Check current state; redemption and refresh are not automatically retried.",
  },
  "remote.error.FORBIDDEN": {
    "zh-CN": "此授权没有该权限。",
    "en-US": "This grant does not allow that operation.",
  },
  "remote.error.STATE_UNAVAILABLE": {
    "zh-CN": "持久授权状态无法核对，访问已关闭。",
    "en-US": "Durable authorization state cannot be reconciled. Access is closed.",
  },
  "remote.error.INVALID_PROJECTS": {
    "zh-CN": "请选择仍在电脑配置中的 1–20 个项目。",
    "en-US": "Select 1–20 projects still configured on your desktop.",
  },
} as const;
export function pairingText(locale: "zh-CN" | "en-US", key: string): string {
  const entry = (pairingMessages as Record<string, { "zh-CN": string; "en-US": string }>)[
    `remote.${key}`
  ];
  return (entry ?? pairingMessages["remote.error_generic"])[locale];
}
