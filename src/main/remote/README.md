# 远程账号登录与电脑登记

桌面端只使用 v2 控制协议。账号登录、电脑登记、中转连接、手机授权是四个独立状态，登录成功不等于电脑已连接，也不批准手机访问。

## 本机实现与恢复

- 账号登录由主进程持有。面板显示打开浏览器、等待登录、验证与安全保存三个阶段；关闭再打开面板不会丢失进度。取消会终止回调监听与令牌交换，过期请求不能覆盖新的凭证。
- 浏览器回调在令牌交换、校验和加密写盘都成功后才显示“账号登录成功”。页面明确要求回到 PiDesk 继续登记或连接，不承诺中转已连接。回调只监听 `127.0.0.1:49182`，该固定地址必须在身份提供方的回调白名单中；端口被占用时给出可恢复错误。
- 普通断线使用“重新连接”，复用当前账号并刷新过期的访问令牌。显式“登录账号”或“重新登录或切换账号”会打开浏览器并要求重新认证。退出只清除 PiDesk 的账号凭证和本机连接，不冒充浏览器的全局 SSO 退出。
- 电脑登记请求在 POST 前由 settings 模块保存到 `remote-enrollment.json`，包含非秘密的请求 ID、中转、名称及已知的账号/电脑 ID。重试和重启继续同一个请求；返回的一次性电脑凭证经 safeStorage 加密保存后才清理登记进度。
- 登记过期、凭证丢失或中转需要更换时，使用“重置电脑登记”。正常重置先停止共享、撤销本机手机授权，再移除中转上的登记，最后清理本机登记。中转移除失败时保留可重试的本机登记，手机访问已经停止。
- “仅重置本机”必须由用户单独确认，适用于离线或本机凭证损坏。该操作明确不移除中转登记；用户可在“管理账号中的电脑”中清理旧记录。目录移除必须确认具体电脑，且不能用当前账号删除其他账号原先拥有的本机登记。
- 项目设置、会话历史和普通桌面进程生命周期不受重置或退出影响。令牌、授权 URL、PKCE verifier 与手机邀请秘密不进入显示快照。

## 页面与主题资源

账号卡片使用 PiDesk 的 Modal、Button、Phosphor 图标和设计令牌。首次登记表单、已登录身份、中转连接与恢复提示分开呈现；断线状态不展示无法使用的二维码卡片。

回调页只使用本地内联样式，不加载脚本、外部字体或远程图片。开发态读取 `tokens.css` 与 `remoteAuthCallback.css`；构建时 Vite 插件将同一份样式输出为 `dist/renderer/remote-auth.css`，随安装包进入 asar。页面按登录开始时的 PiDesk 语言和明暗主题呈现。

## Auth0 托管登录页

Auth0 托管页由租户配置控制，本地代码不能替代租户中的发布步骤。仓库没有部署中转或自动修改 Auth0 租户的脚本；下面的文件是可审查的配置产物，不能据此声称线上主题已经应用。

运行 `pnpm build:renderer` 后会生成：

- `dist/renderer/remote-auth-branding-dark.json`
- `dist/renderer/remote-auth-branding-light.json`

两份文件从当前 `tokens.css` 派生按钮、文字、输入框、背景、状态色、字号和圆角，供管理员更新现有 Universal Login theme。选择其中一套作为租户默认配色；不要假设 Auth0 默认主题会自动跟随每台电脑的应用主题。更新前应读取并保留租户当前主题，检查差异后通过管理后台或 Management API 应用到指定主题。JSON 是字段覆盖片段：将其按字段合并到现有主题，保留原有 Logo、字体 URL、相对字号及其他未列出的设置。

托管页交付时需要在租户中完成以下核验：

1. 桌面应用类型为 Native，启用 Authorization Code + PKCE、Refresh Token 和旋转刷新令牌；API audience 与桌面/中转当前部署一致。回调允许 `http://127.0.0.1:49182/callback`。
2. 启用 Universal Login，并在 Tenant Settings 中启用 `en` 与 `zh-CN`。PiDesk 会在授权请求传入 `ui_locales=en` 或 `zh-CN`；应用自身仍使用 `en-US`/`zh-CN`。
3. 应用可识别的名称为 PiDesk；在 Branding → Universal Login 中应用已审查的主题。Logo/字体如需定制，必须使用租户可访问的 HTTPS 资源；本机安装路径不能作为托管页资源 URL。
4. 使用后台的 Try 预览及真实桌面账号，分别检查中英文、成功/取消/拒绝/超时、重新认证、刷新、退出后再次登录，以及桌面与手机使用同一账号的登记和连接。

本地协议测试和模拟界面核验不替代这一步真实账号与租户配置验收。

## 验证

`pnpm typecheck` 检查三层 IPC 与界面契约；主进程 vitest 覆盖回调 state、PKCE、延迟令牌响应、取消与重试、持久化失败、过期/损坏凭证、登记幂等、账号隔离和先本地撤销再移除中转的顺序。渲染层使用实际组件进行本地模拟快照核验，不新增渲染测试框架。

## 官方参考

- [Universal Login Internationalization](https://auth0.com/docs/customize/internationalization-and-localization/universal-login-internationalization)
- [Customize Universal Login Page Themes](https://auth0.com/docs/customize/login-pages/universal-login/customize-themes)
- [Branding theme fields](https://auth0.com/docs/api/management/v2/branding/post-branding-theme)
