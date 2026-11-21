import { defineMessages } from "../types";

export const remoteSettingsMessages = defineMessages({
  "settings.remote.accountTitle": {
    "zh-CN": "远程账号与电脑登记",
    "en-US": "Remote account and computer registration",
  },
  "settings.remote.desktopName": { "zh-CN": "电脑显示名称", "en-US": "Computer display name" },
  "settings.remote.accountConnect": {
    "zh-CN": "登录并登记此电脑",
    "en-US": "Sign in and register this computer",
  },
  "settings.remote.accountReconnect": {
    "zh-CN": "重新登录账号",
    "en-US": "Sign in again",
  },
  "settings.remote.accountLogout": {
    "zh-CN": "退出远程账号",
    "en-US": "Sign out of remote account",
  },
  "settings.remote.readonly": {
    "zh-CN": "每台手机可访问这台电脑的全部已配置项目与支持的远程操作；每个请求仍由桌面校验。",
    "en-US":
      "Each phone can access every configured project and supported action on this computer. The desktop checks every request.",
  },
  "settings.remote.origin": { "zh-CN": "中转地址（HTTPS）", "en-US": "Relay address (HTTPS)" },
  "settings.remote.trust": {
    "zh-CN": "已核对域名，并信任此中转",
    "en-US": "I checked the domain and trust this relay",
  },
  "settings.remote.connecting": { "zh-CN": "正在连接…", "en-US": "Connecting…" },
  "settings.remote.securityTitle": {
    "zh-CN": "仅使用可信的自部署中转。",
    "en-US": "Use only a trusted, self-hosted relay.",
  },
  "settings.remote.securityBody": {
    "zh-CN": "非端到端加密，中转可读取内容并冒充设备。",
    "en-US": "No end-to-end encryption. The relay can read content and impersonate devices.",
  },
  "settings.remote.ready": { "zh-CN": "准备配对", "en-US": "Ready to pair" },
  "settings.remote.waiting": { "zh-CN": "等待扫码", "en-US": "Waiting for scan" },
  "settings.remote.expired": { "zh-CN": "邀请已过期", "en-US": "Invitation expired" },
  "settings.remote.scanTitle": { "zh-CN": "扫码连接手机", "en-US": "Scan to pair your phone" },
  "settings.remote.stepOpen": { "zh-CN": "打开 Pi-Mobile", "en-US": "Open Pi-Mobile" },
  "settings.remote.stepScan": { "zh-CN": "扫描二维码", "en-US": "Scan the QR code" },
  "settings.remote.stepApprove": {
    "zh-CN": "在电脑核对并授权",
    "en-US": "Verify and approve here",
  },
  "settings.remote.noQr": { "zh-CN": "尚未生成二维码", "en-US": "No invitation yet" },
  "settings.remote.qrExpired": { "zh-CN": "二维码已过期", "en-US": "QR code expired" },
  "settings.remote.qrLoading": { "zh-CN": "正在生成二维码…", "en-US": "Generating QR code…" },
  "settings.remote.generate": { "zh-CN": "生成二维码", "en-US": "Create QR code" },
  "settings.remote.regenerate": { "zh-CN": "重新生成", "en-US": "Generate again" },
  "settings.remote.refresh": { "zh-CN": "刷新二维码", "en-US": "Refresh QR code" },
  "settings.remote.expiry": { "zh-CN": "{time} 后过期", "en-US": "Expires in {time}" },
  "settings.remote.devices": { "zh-CN": "已配对设备", "en-US": "Paired devices" },
  "settings.remote.empty": { "zh-CN": "暂无配对设备", "en-US": "No paired devices" },
  "settings.remote.device": { "zh-CN": "配对手机", "en-US": "Paired phone" },
  "settings.remote.relay": { "zh-CN": "中转服务", "en-US": "Relay service" },
  "settings.remote.connected": { "zh-CN": "已连接", "en-US": "Connected" },
  "settings.remote.disconnected": { "zh-CN": "未连接", "en-US": "Disconnected" },
  "settings.remote.manage": { "zh-CN": "管理连接", "en-US": "Manage connection" },
  "settings.remote.collapse": { "zh-CN": "收起", "en-US": "Collapse" },
  "settings.remote.pause": { "zh-CN": "暂停连接", "en-US": "Pause connection" },
  "settings.remote.reconnect": { "zh-CN": "重新连接", "en-US": "Reconnect" },
  "settings.remote.offlineTitle": { "zh-CN": "中转未连接", "en-US": "Relay disconnected" },
  "settings.remote.offlinePaired": {
    "zh-CN": "授权保留，手机暂不可访问。",
    "en-US": "Access is paused. Existing permissions are retained.",
  },
  "settings.remote.offlineUnpaired": {
    "zh-CN": "重新连接后即可配对。",
    "en-US": "Reconnect to pair your phone.",
  },
  "settings.remote.request": { "zh-CN": "请求配对", "en-US": "Pairing request" },
  "settings.remote.nameHint": { "zh-CN": "名称仅供参考", "en-US": "Device-reported name" },
  "settings.remote.matched": {
    "zh-CN": "双端域名与 8 位数字一致",
    "en-US": "The domain and all 8 digits match on both devices",
  },
  "settings.remote.grantAllProjects": {
    "zh-CN": "全部已配置项目",
    "en-US": "All configured projects",
  },
  "settings.remote.grantProjectCount": {
    "zh-CN": "当前 {count} 个项目",
    "en-US": "{count} current projects",
  },
  "settings.remote.grantFutureProjects": {
    "zh-CN": "包含以后新增的项目；项目移除或替换时授权会自动撤销。",
    "en-US":
      "Includes projects added later. Access is revoked when an authorized project is removed or replaced.",
  },
  "settings.remote.grantAllActions": {
    "zh-CN": "全部已实现的 v2 操作",
    "en-US": "All implemented v2 actions",
  },
  "settings.remote.grantAllSummary": {
    "zh-CN": "全部 {count} 个项目 · {permissions} 项远程操作",
    "en-US": "All {count} projects · {permissions} remote actions",
  },
  "settings.remote.grantAllWarning": {
    "zh-CN":
      "确认后，此手机可查看所有项目和会话、发送消息、停止任务、新建会话及处理待办交互。请仅批准你认可的设备。",
    "en-US":
      "This phone can view all projects and sessions, send messages, stop tasks, create sessions, and handle pending interactions. Approve only a device you trust.",
  },
  "settings.remote.matchFirst": {
    "zh-CN": "请先核对域名与数字",
    "en-US": "Verify the domain and code",
  },
  "settings.remote.noProjects": {
    "zh-CN": "当前没有配置项目",
    "en-US": "No projects are configured",
  },
  "settings.remote.approve": {
    "zh-CN": "确认并开放全部项目与操作",
    "en-US": "Approve all projects and supported actions",
  },
  "settings.remote.activation": { "zh-CN": "等待双端激活", "en-US": "Waiting for activation" },
  "settings.remote.expiredClaim": {
    "zh-CN": "配对请求已过期，请重新扫码。",
    "en-US": "This request expired. Scan a new invitation.",
  },
  "settings.remote.capabilities": { "zh-CN": "授权能力", "en-US": "Allowed capabilities" },
  "settings.remote.changePermissions": {
    "zh-CN": "调整权限需重新配对",
    "en-US": "Pair again to change permissions",
  },
  "settings.remote.revoke": { "zh-CN": "撤销授权", "en-US": "Revoke access" },
  "settings.remote.revokeTitle": { "zh-CN": "撤销手机授权？", "en-US": "Revoke phone access?" },
  "settings.remote.revokeBody": {
    "zh-CN": "手机将立即失去访问权限。项目与会话保留，再次访问需重新配对。",
    "en-US":
      "The phone will lose access immediately. Projects and sessions are kept. Pair again to restore access.",
  },
  "settings.remote.retry": { "zh-CN": "重试", "en-US": "Retry" },
});
