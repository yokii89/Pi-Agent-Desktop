import { defineMessages } from "../types";

export const remoteAccountMessages = defineMessages({
  "settings.remote.signedIn": { "zh-CN": "已登录", "en-US": "Signed in" },
  "settings.remote.signedOut": { "zh-CN": "未登录", "en-US": "Signed out" },
  "settings.remote.savedAccount": { "zh-CN": "已保存的远程账号", "en-US": "Saved remote account" },
  "settings.remote.identityUnavailable": {
    "zh-CN": "暂时无法读取账号名称，连接仍使用已登录的账号。",
    "en-US": "The account name is unavailable. Connections still use your signed-in account.",
  },
  "settings.remote.signIn": { "zh-CN": "登录账号", "en-US": "Sign in" },
  "settings.remote.switchAccount": {
    "zh-CN": "重新登录或切换账号",
    "en-US": "Sign in again or switch account",
  },
  "settings.remote.enrollComputer": {
    "zh-CN": "登记此电脑并连接",
    "en-US": "Register this computer and connect",
  },
  "settings.remote.resumeEnrollment": { "zh-CN": "继续电脑登记", "en-US": "Continue registration" },
  "settings.remote.enrollmentSaved": {
    "zh-CN":
      "已保留上次登记请求。继续时会核对同一请求，不会重复创建电脑。修改中转或名称前请先重置登记。",
    "en-US":
      "Your registration request is saved. Continuing reconciles the same request without creating another computer. Reset registration before changing the relay or name.",
  },
  "settings.remote.openingBrowser": {
    "zh-CN": "正在打开系统浏览器…",
    "en-US": "Opening your browser…",
  },
  "settings.remote.waitingForBrowser": {
    "zh-CN": "请在浏览器中完成登录",
    "en-US": "Complete sign-in in your browser",
  },
  "settings.remote.exchangingCode": {
    "zh-CN": "正在验证账号并安全保存凭证…",
    "en-US": "Verifying your account and saving credentials securely…",
  },
  "settings.remote.loginWaitingHint": {
    "zh-CN": "完成后将自动返回当前流程。关闭浏览器不会取消请求，可在这里取消。",
    "en-US":
      "This flow continues automatically after sign-in. Closing the browser does not cancel the request; cancel it here.",
  },
  "settings.remote.loginRemaining": { "zh-CN": "剩余 {time}", "en-US": "{time} remaining" },
  "settings.remote.cancelLogin": { "zh-CN": "取消登录", "en-US": "Cancel sign-in" },
  "settings.remote.cancellingLogin": { "zh-CN": "正在取消…", "en-US": "Cancelling…" },
  "settings.remote.enrolling": {
    "zh-CN": "正在核对并登记电脑…",
    "en-US": "Reconciling and registering this computer…",
  },
  "settings.remote.signingIn": {
    "zh-CN": "正在登录并连接账号…",
    "en-US": "Signing in and connecting your account…",
  },
  "settings.remote.signingOut": {
    "zh-CN": "正在退出远程账号…",
    "en-US": "Signing out of your remote account…",
  },
  "settings.remote.resetting": {
    "zh-CN": "正在重置电脑登记…",
    "en-US": "Resetting computer registration…",
  },
  "settings.remote.paused": { "zh-CN": "已暂停", "en-US": "Paused" },
  "settings.remote.connectionNeedsAccount": {
    "zh-CN": "登录账号后即可恢复中转连接。",
    "en-US": "Sign in to restore the relay connection.",
  },
  "settings.remote.registrationExpired": {
    "zh-CN": "电脑登记已失效",
    "en-US": "Computer registration expired",
  },
  "settings.remote.registrationRecovery": {
    "zh-CN": "请重置旧登记，再登记此电脑。项目和会话历史不会受到影响，手机需要重新配对。",
    "en-US":
      "Reset the old registration, then register this computer again. Projects and session history are kept. Your phone will need to pair again.",
  },
  "settings.remote.resetEnrollment": {
    "zh-CN": "重置电脑登记",
    "en-US": "Reset computer registration",
  },
  "settings.remote.resetTitle": {
    "zh-CN": "重置这台电脑的远程登记？",
    "en-US": "Reset this computer’s remote registration?",
  },
  "settings.remote.resetBody": {
    "zh-CN":
      "先停止本机共享并撤销手机访问，再移除中转上的电脑登记。项目、会话和历史保留。完成后可更换中转或重新登记，手机需要重新配对。",
    "en-US":
      "Local sharing stops and phone access is revoked before the relay registration is removed. Projects, sessions and history are kept. You can then change relays or register again; your phone must pair again.",
  },
  "settings.remote.resetLocalBody": {
    "zh-CN":
      "本机将停止共享并清除远程登记，项目、会话和历史保留。此操作不会移除中转上的登记；恢复登录后，可在账号电脑目录中清理旧登记。",
    "en-US":
      "Local sharing stops and remote registration is cleared. Projects, sessions and history are kept. The relay registration is not removed; clean it up in your account’s computer directory after signing in again.",
  },
  "settings.remote.resetLocalWarning": {
    "zh-CN": "“仅重置本机”可用于中转离线或凭证损坏时；中转上的旧登记仍需在账号电脑目录中移除。",
    "en-US":
      "Use “Reset locally only” if the relay is offline or credentials are damaged. Remove the old relay registration from your account’s computer directory later.",
  },
  "settings.remote.removeAndReset": {
    "zh-CN": "移除登记并重置",
    "en-US": "Remove registration and reset",
  },
  "settings.remote.resetLocalOnly": { "zh-CN": "仅重置本机", "en-US": "Reset locally only" },
  "settings.remote.directory": { "zh-CN": "管理账号中的电脑", "en-US": "Manage account computers" },
  "settings.remote.directoryHint": {
    "zh-CN": "可移除未完成或已失效的登记，释放账号名额。移除其他电脑也会停止其远程访问。",
    "en-US":
      "Remove unfinished or expired registrations to free an account slot. Removing another computer also disables its remote access.",
  },
  "settings.remote.directoryEmpty": {
    "zh-CN": "此账号中没有电脑登记",
    "en-US": "No computers registered to this account",
  },
  "settings.remote.directoryRefresh": { "zh-CN": "刷新目录", "en-US": "Refresh directory" },
  "settings.remote.thisComputer": { "zh-CN": "此电脑", "en-US": "This computer" },
  "settings.remote.removeComputer": { "zh-CN": "移除登记", "en-US": "Remove registration" },
  "settings.remote.removeComputerTitle": {
    "zh-CN": "移除电脑登记？",
    "en-US": "Remove computer registration?",
  },
  "settings.remote.removeComputerBody": {
    "zh-CN":
      "将移除“{name}”的远程登记并停止其手机访问。电脑上的项目、会话和历史保留，再次访问需要重新登记和配对。",
    "en-US":
      "Remove the remote registration for “{name}” and disable phone access. Its projects, sessions and history are kept. Register and pair again to restore access.",
  },
  "settings.remote.registrationState.registered": { "zh-CN": "已登记", "en-US": "Registered" },
  "settings.remote.registrationState.reserved": { "zh-CN": "等待登记", "en-US": "Reserved" },
  "settings.remote.registrationState.room_initializing": {
    "zh-CN": "正在初始化",
    "en-US": "Initializing",
  },
  "settings.remote.registrationState.revocation_pending": {
    "zh-CN": "等待移除",
    "en-US": "Removal pending",
  },
  "settings.remote.registrationState.revoked": { "zh-CN": "已移除", "en-US": "Removed" },
  "settings.remote.registrationState.failed": {
    "zh-CN": "登记失败",
    "en-US": "Registration failed",
  },
  "settings.remote.registrationState.expired": { "zh-CN": "已过期", "en-US": "Expired" },
  "settings.remote.callback.success.title": {
    "zh-CN": "账号登录成功",
    "en-US": "Account sign-in complete",
  },
  "settings.remote.callback.success.body": {
    "zh-CN": "账号凭证已安全保存。请返回 PiDesk 完成电脑登记或连接；手机访问仍需单独批准。",
    "en-US":
      "Your account credentials were saved securely. Return to PiDesk to finish computer registration or connection. Phone access still requires separate approval.",
  },
  "settings.remote.callback.error.title": {
    "zh-CN": "账号登录未完成",
    "en-US": "Account sign-in did not complete",
  },
  "settings.remote.callback.error.body": {
    "zh-CN": "请返回 PiDesk 查看原因并重试。",
    "en-US": "Return to PiDesk to check the error and try again.",
  },
  "settings.remote.callback.cancelled.title": {
    "zh-CN": "已取消账号登录",
    "en-US": "Account sign-in cancelled",
  },
  "settings.remote.callback.cancelled.body": {
    "zh-CN": "本次请求已结束，没有批准新的手机访问。",
    "en-US": "This request has ended. No new phone access was approved.",
  },
  "settings.remote.callback.return": {
    "zh-CN": "可以关闭此页面并返回 PiDesk。",
    "en-US": "You can close this page and return to PiDesk.",
  },
  "settings.remote.registrationNeedsRecovery": {
    "zh-CN": "电脑登记需要恢复",
    "en-US": "Computer registration needs recovery",
  },
  "remote.error.SECURE_STORAGE_UNAVAILABLE": {
    "zh-CN":
      "系统安全存储不可用，远程访问已暂停。请检查系统账号与凭证保护服务，恢复后重试；凭证不会以明文保存。",
    "en-US":
      "System secure storage is unavailable and remote access is paused. Check your system account and credential protection, then retry. Credentials are never saved in plaintext.",
  },
  "remote.error.AUTH_EXPIRED": {
    "zh-CN": "电脑凭证已到期，请重置电脑登记，再重新登记和配对。",
    "en-US":
      "The computer credential expired. Reset computer registration, then register and pair again.",
  },
  "remote.error.AUTH_CANCELLED": { "zh-CN": "已取消登录。", "en-US": "Sign-in cancelled." },
  "remote.error.AUTH_CALLBACK_TIMEOUT": {
    "zh-CN": "等待浏览器登录超时，请重新登录。",
    "en-US": "Browser sign-in timed out. Start sign-in again.",
  },
  "remote.error.AUTH_PORT_IN_USE": {
    "zh-CN":
      "登录回调端口 49182 正被其他程序占用。请关闭占用该端口的程序或另一个 PiDesk 登录窗口，然后重试。",
    "en-US":
      "Sign-in callback port 49182 is in use. Close the program using it or another PiDesk sign-in window, then retry.",
  },
  "remote.error.AUTH_CALLBACK_UNAVAILABLE": {
    "zh-CN": "无法启动本机登录回调，请检查本机网络权限后重试。",
    "en-US":
      "The local sign-in callback could not start. Check local network permissions and retry.",
  },
  "remote.error.AUTH_BROWSER_OPEN_FAILED": {
    "zh-CN": "无法打开系统浏览器。请检查默认浏览器设置后重试。",
    "en-US": "Your browser could not be opened. Check the default browser setting and retry.",
  },
  "remote.error.AUTH_NETWORK_UNAVAILABLE": {
    "zh-CN": "无法连接账号登录服务，请检查网络后重试。",
    "en-US": "The account service could not be reached. Check your network and retry.",
  },
  "remote.error.AUTH_NETWORK_TIMEOUT": {
    "zh-CN": "账号服务响应超时，请检查网络后重试。",
    "en-US": "The account service timed out. Check your network and retry.",
  },
  "remote.error.AUTH_EXCHANGE_FAILED": {
    "zh-CN": "账号验证未通过，请重新登录；若持续失败，请核对登录服务配置。",
    "en-US":
      "Account verification failed. Sign in again. If the problem persists, check the identity service configuration.",
  },
  "remote.error.AUTH_RESPONSE_INVALID": {
    "zh-CN": "账号服务返回了无效响应，未保存新的登录凭证。请重试。",
    "en-US":
      "The account service returned an invalid response. No new credentials were saved. Try again.",
  },
  "remote.error.AUTH_REAUTH_REQUIRED": {
    "zh-CN": "账号登录已失效，请重新登录。",
    "en-US": "Your account session expired. Sign in again.",
  },
  "remote.error.AUTH_STORE_INVALID": {
    "zh-CN": "本机保存的账号凭证无法读取。请重新登录，或退出远程账号以清除旧凭证。",
    "en-US":
      "Saved account credentials could not be read. Sign in again, or sign out to clear them.",
  },
  "remote.error.AUTH_STORE_WRITE_FAILED": {
    "zh-CN": "账号凭证未能安全保存，请检查本机磁盘和写入权限后重试。",
    "en-US":
      "Account credentials could not be saved securely. Check local disk space and write permissions, then retry.",
  },
  "remote.error.AUTH_STORE_CLEAR_FAILED": {
    "zh-CN": "本机账号凭证未能完全清除，请检查文件权限并再次退出账号。",
    "en-US":
      "Local account credentials could not be fully erased. Check file permissions and sign out again.",
  },
  "remote.error.AUTH_CHANGED": {
    "zh-CN": "登录请求已被取消或替换，请重新连接。",
    "en-US": "The sign-in request was cancelled or replaced. Connect again.",
  },
  "remote.error.AUTH_STATE_INVALID": {
    "zh-CN": "此登录回调与当前请求不匹配，请回到最初打开的登录页面完成操作。",
    "en-US":
      "This callback does not match the current sign-in request. Complete sign-in in the original browser page.",
  },
  "remote.error.AUTH_CODE_MISSING": {
    "zh-CN": "登录回调缺少有效授权码，请重新登录。",
    "en-US": "The callback did not contain a valid authorization code. Sign in again.",
  },
  "remote.error.ACCOUNT_MISMATCH": {
    "zh-CN": "当前账号与这台电脑原登记的账号不同。请登录原账号，或重置电脑登记后使用新账号。",
    "en-US":
      "This account differs from the computer’s registered account. Sign in to the original account, or reset registration to use the new account.",
  },
  "remote.error.REGISTRATION_STORE_INVALID": {
    "zh-CN": "无法读取未完成的电脑登记。请在账号电脑目录中核对后，重置本机登记。",
    "en-US":
      "The unfinished registration could not be read. Check your account’s computer directory, then reset local registration.",
  },
  "remote.error.REGISTRATION_STORE_WRITE_FAILED": {
    "zh-CN": "无法保存或清理电脑登记进度，请检查本机磁盘和写入权限后重试。",
    "en-US":
      "Registration progress could not be saved or cleared. Check local disk space and write permissions, then retry.",
  },
  "remote.error.CONTROL_FAILED": {
    "zh-CN": "中转操作未完成，请重试或核对当前连接状态。",
    "en-US": "The relay operation did not complete. Retry or check the current connection state.",
  },
  "remote.error.BUSY": {
    "zh-CN": "另一项远程操作正在进行，请稍候。",
    "en-US": "Another remote operation is in progress. Please wait.",
  },
});
