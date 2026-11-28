# Monet Chat 1.4.0

P2P 优先、端到端加密、Material 3 动态取色的全平台聊天应用。

外面看起来只是「分享一个码，就能聊天」；复杂功能都收在设置与会话信息里。

- 仓库：<https://github.com/9527-tech/monet-chat>
- 永久公网地址：<https://monet-chat.tailb40225.ts.net>
- 发布页：<https://github.com/9527-tech/monet-chat/releases/tag/v1.4.0>
- 1.4.0 新内容：完整 Material 3 重构、手机底部导航、平板/桌面自适应双栏、全屏手机设置、二维码扫描、旧邀请码自动恢复、历史消息上滑修复、图片/文件卡片重排；保留后台保活、触感反馈、单图标启动页、自动公网与自动更新。

## 功能

- **P2P 直连**：WebRTC DataChannel mesh，消息与文件不经服务器；服务器只做房间发现和 SDP/ICE 交换。
- **端到端加密**：ECDSA P-256 身份签名 + ECDH P-256 + HKDF-SHA256 + AES-256-GCM；12 组安全码人工核对。
- **固定朋友列表**：联系人独立持久化，对方离线后仍保留；上线自动恢复房间。
- **本地历史**：IndexedDB 保存会话、消息、联系人、设置，刷新/重启不丢。
- **图片与文件**：8 MB 以内图片直接接收；超过 8 MB 自动按文件处理，必须点击「接收」才传输；其他文件同样需要显式接收。
- **分享即聊天**：邀请码 + 二维码扫描加入；默认极简界面，通话、安全码、P2P 状态收进信息面板。
- **通话**：语音、视频、屏幕共享（桌面端）、本地快照、通话记录。
- **Material You**：9 张壁纸、8 种配色风格、对比度、自定义取色；深浅色随系统或手动切换。
- **全平台**：Windows / Android / Linux 原生包；macOS、iOS 提供 Xcode 工程和构建说明。
- **公网可达**：启动即自动建立公网入口。安装并登录 Tailscale 后得到**永久 HTTPS 地址**；否则自动退回 Cloudflare 临时地址。
- **自动更新**：应用内检查新版本；Windows 下载后静默覆盖安装，Android 下载 APK 覆盖安装，不需要先卸载。
- **后台保活**：设置 → 通用可关闭/开启。桌面端关闭窗口后缩小到托盘；Android 使用前台服务保持在线。
- **触感反馈**：设置 → 通用可关闭/开启；按钮、切换、发送和长按消息使用系统触感。

## 原生安装包

| 平台 | 文件 |
| --- | --- |
| Android | [`MonetChat-1.4.0.apk`](release/MonetChat-1.4.0.apk) |
| Windows 安装版 | [`MonetChat-Setup-1.4.0.exe`](release/MonetChat-Setup-1.4.0.exe) |
| Windows 便携版 | [`MonetChat-Portable-1.4.0.exe`](release/MonetChat-Portable-1.4.0.exe) |
| Linux x64 | [`MonetChat-1.4.0-linux-x64.tar.gz`](release/MonetChat-1.4.0-linux-x64.tar.gz) |

Windows 安装包未签名，SmartScreen 提示时选择「更多信息 → 仍要运行」。Android 覆盖安装会保留本地数据，不会清空聊天记录。

## 快速开始

### Windows

1. 运行 `MonetChat-Setup-1.4.0.exe`，或直接运行免安装的 Portable 版。
2. 首次启动填写昵称，等待网络状态变成「在线」。
3. 点「分享邀请码」，把邀请码/二维码发给朋友。

### Android

1. 安装 `MonetChat-1.4.0.apk`。
2. 首次启动填写昵称和信令服务器地址：
   - 同一 Wi-Fi：`http://192.168.0.5:4175`
   - 公网：`https://monet-chat.tailb40225.ts.net`
3. 点「分享邀请码」，或点扫码按钮扫描对方的二维码。

### Linux

```bash
tar -xzf MonetChat-1.4.0-linux-x64.tar.gz
cd linux-unpacked
chmod +x monet-chat
./monet-chat
```

## 公网与永久地址

- 已安装 Tailscale 并登录后，启动会自动执行 Funnel，永久地址为 `https://monet-chat.tailb40225.ts.net`。
- 未安装 Tailscale 时自动使用 Cloudflare 临时地址，重启会变化。
- 首次启用 Tailscale：双击桌面「启用永久公网.cmd」，按提示安装并登录；之后开机自动生效。
- 详细排错与联调记录见 [docs/远程访问与联调实录.md](docs/远程访问与联调实录.md) 和 [docs/永久公网与自动更新.md](docs/永久公网与自动更新.md)。

## 架构

```
手机/PC 浏览器或原生壳
        │  WebSocket /ws（信令、房间、SDP/ICE）
        ▼
Node 信令与静态服务器（server.mjs，零框架）
        │
        ├─ Tailscale Funnel（永久 HTTPS，可选）
        └─ Cloudflare Quick Tunnel（临时 HTTPS，兜底）
        │
        ▼
WebRTC DataChannel mesh（消息/文件/通话，端到端加密）
```

- 身份：ECDSA P-256；每对设备 ECDH P-256 → HKDF-SHA256 → AES-256-GCM。
- 房间：内存房间，24 小时 TTL；旧邀请码在服务器重启后会自动重建同名房间。
- 文件：先发元数据，接收方点击后再走独立加密文件通道；分片完整性校验。
- 通话：CallManager 通过加密数据通道交换 SDP/ICE；默认带公共 TURN 兜底（部分网络会屏蔽）。

## 开发

```bash
npm install
npm start                # http://localhost:4173
npm run test:all         # e2e / group / calls / ui / extra / offline / pwa / tablet
npm run icons            # 重新生成图标与图标字体子集
npm run native:web       # 生成 www
npm run native:sync      # Capacitor 同步 Android/iOS
npm run android:release  # 签名 APK
npm run dist:win         # Windows NSIS + Portable
npm run dist:linux       # Linux tar
```

需要 Node 22+；Android 构建需要 JDK 21、Android SDK 35；Windows 打包使用 `electron-builder`。

## 已知限制

- 公网链路依赖 Tailscale Funnel 或 Cloudflare；两者都不可用时只能局域网。
- TURN 在部分移动网络被运营商屏蔽，跨 NAT 通话可能失败；失败时会提示原因。
- Android WebView 不支持屏幕共享，按钮会自动隐藏；请在 Windows 桌面端发起。
- 离线消息只在发送方页面存活期间排队，关闭应用后不会由服务器代存。
- Windows 安装包未做代码签名；Android 更新仍需系统安装确认。
- 群聊 mesh 最多 12 人；人数越多，上行带宽和连接数越高。

## 目录

```
├─ app.js / app.css / index.html    前端单页
├─ server.mjs                       信令 + 静态 + 公网/更新接口
├─ src/                             加密、P2P、通话、主题、UI、渲染
├─ electron/                        Windows 桌面壳、托盘、更新 IPC
├─ android/                         Capacitor Android 工程
├─ ios/ macos/ linux/               各平台工程与说明
├─ docs/                            公网、自动更新、联调记录
├─ scripts/                         构建与 Playwright 验证脚本
└─ release/                         安装包与校验和
```

MIT License.
