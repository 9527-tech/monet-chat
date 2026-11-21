# Monet Chat

P2P 优先、端到端加密、Material You 动态取色的全平台聊天应用。

> 外面看起来只是「分享一个码，就能聊天」；复杂的东西都收在设置和会话信息里。

- 仓库：<https://github.com/9527-tech/monet-chat>
- 最新版本：**1.2.0**
- 发布页：<https://github.com/9527-tech/monet-chat/releases/tag/v1.2.0>
- 1.2.0：启动即自动建立公网入口（Tailscale Funnel 永久地址，缺失时自动 Cloudflare 临时地址）；应用内检查更新、Windows 自动覆盖安装、Android 覆盖安装；1.2.0 的壁纸取色/头像裁切/动画/状态栏同步全部保留。

## 功能

- **P2P 直连**：WebRTC DataChannel mesh，消息和文件不经过服务器；服务器只做房间发现和 SDP/ICE 交换。
- **端到端加密**：ECDSA P-256 身份签名 + ECDH P-256 + HKDF-SHA256 + AES-256-GCM；支持 12 组安全码人工核对。
- **固定朋友列表**：联系人独立持久化，对方离线后仍保留；上线自动恢复房间。
- **本地历史**：IndexedDB 保存会话、消息、联系人、设置，刷新/重启不丢。
- **图片与文件**：8 MB 以内图片直接接收；超过 8 MB 自动按文件处理，必须点击「接收」才传输；其他文件同样需要显式接收。
- **分享即聊天**：邀请码 + 二维码；默认极简界面，通话、安全码、P2P 状态收进信息面板。
- **通话**：语音、视频、屏幕共享、本地快照、通话记录。
- **Material You**：9 张壁纸、8 种配色风格、对比度、自定义取色；深浅色随系统或手动切换。
- **全平台**：Windows / Android / Linux 原生包；macOS、iOS 提供 Xcode 工程和构建说明。
- **公网可达**：启动即自动建立公网入口。安装并登录 Tailscale 后得到**永久 HTTPS 地址**；否则自动退回 Cloudflare 临时地址。
- **自动更新**：应用内检查新版本，Windows 下载后自动覆盖安装；Android 下载 APK 覆盖安装，不需要先卸载。详见 [永久公网与自动更新](docs/永久公网与自动更新.md)。

## 原生安装包

| 平台 | 文件 |
| --- | --- |
| Android | [`MonetChat-1.2.0.apk`](https://github.com/9527-tech/monet-chat/releases/download/v1.2.0/MonetChat-1.2.0.apk) |
| Windows 安装版 | [`MonetChat-Setup-1.2.0.exe`](https://github.com/9527-tech/monet-chat/releases/download/v1.2.0/MonetChat-Setup-1.2.0.exe) |
| Windows 便携版 | [`MonetChat-Portable-1.2.0.exe`](https://github.com/9527-tech/monet-chat/releases/download/v1.2.0/MonetChat-Portable-1.2.0.exe) |
| Linux x64 | [`MonetChat-1.2.0-linux-x64.tar.gz`](https://github.com/9527-tech/monet-chat/releases/download/v1.2.0/MonetChat-1.2.0-linux-x64.tar.gz) |
| 源码包 | [`monet-chat-1.2.0-source.zip`](https://github.com/9527-tech/monet-chat/releases/download/v1.2.0/monet-chat-1.2.0-source.zip) |
| 完整 Git 历史 | [`monet-chat-1.2.0.bundle`](https://github.com/9527-tech/monet-chat/releases/download/v1.2.0/monet-chat-1.2.0.bundle) |

校验和见 [`release/SHA256SUMS-1.2.0.txt`](release/SHA256SUMS-1.2.0.txt)。

### 第一次使用

1. 电脑启动服务（EXE 会自动启动内置服务）：

   ```powershell
   npm install
   npm start
   ```

2. 电脑打开 `http://127.0.0.1:4173`，创建身份，点「分享邀请码」。
3. 手机和电脑在同一 Wi-Fi：手机打开 `http://<电脑局域网IP>:4173`。
4. 手机在外网：应用会自动建立公网入口。安装一次 Tailscale 并登录，即可获得永久地址；没有 Tailscale 时使用自动生成的 Cloudflare 临时地址。详见 [永久公网与自动更新](docs/永久公网与自动更新.md)。
5. 两端输入同一个邀请码即可。

> APK 首次启动会要求填「服务器地址」：局域网填 `http://<电脑IP>:4173`，外网填隧道 HTTPS 地址。

## 快速开始

```bash
npm install
npm start          # http://localhost:4173
npm run test:all   # Playwright 全量场景（需要 Edge）
```

端口可改：

```powershell
$env:PORT='4175'
node server.mjs
```

## 远程访问

应用会自动选择公网通道，**不需要手动开隧道**：

1. 检测到已安装并登录的 Tailscale → 启动 Funnel，得到永久的 `https://<设备>.<tailnet>.ts.net`。
2. 没有 Tailscale → 自动启动 Cloudflare Quick Tunnel（自动尝试可用 edge IP），得到临时地址。
3. 邀请二维码/链接会自动使用当前公网地址；设置 → 网络里能看到“永久/临时”状态。

由于 Cloudflare 会缓冲 SSE，本项目信令已改为 **WebSocket**（`/ws`），`/api/events` 仅保留给本地/兼容场景。完整安装步骤、DNS 污染、双层 NAT、403/1034 排障：

- [`docs/永久公网与自动更新.md`](docs/永久公网与自动更新.md)
- [`docs/远程访问与联调实录.md`](docs/远程访问与联调实录.md)

自动更新：设置 → 关于 → 检查更新。Windows 下载后自动覆盖安装；Android 下载 APK 覆盖安装，不需要先卸载。

## 架构

```text
Browser A ── HTTPS/WSS ── server.mjs ── HTTPS/WSS ── Browser B
     │                        │
     └──── WebRTC DataChannel（加密）────┘
```

- `server.mjs`：零依赖 Node HTTP 服务；内存房间（TTL 24h）、WebSocket 信令、SDP/ICE 转发、静态文件、SPA 回退、Cloudflare 隧道管理。
- `src/signaling.js`：WebSocket 信令客户端；优先 WS，`file://` 回退 SSE；断线重连。
- `src/peer.js`：WebRTC mesh；每对 peer 两条有序通道：`monet-data`（JSON）和 `monet-file`（分片帧）；48KB 分片、缓冲水位流控、队列、重连、文件完整性检查。
- `src/crypto.js`：身份、签名资料、ECDH + HKDF、AES-GCM。
- `src/db.js`：IndexedDB 封装（profile/settings/chats/messages/peers）。
- `src/theme.js`：MCU 取色与 CSS 变量、壁纸处理。
- `src/ui.js` / `src/render.js`：Material 3 组件（模态、菜单、Toast、灯箱、Emoji、二维码）与消息/列表/信息面板/通话渲染。
- `src/calls.js`：通话状态机、媒体流、屏幕共享、通话信令。
- `app.js`：应用编排（会话、消息、附件、设置、PWA、快捷键）。
- `electron/main.cjs`：Windows 壳，启动内置服务并加载界面。
- `android/`：Capacitor Android 工程。

### 加密细节

- 身份签名：ECDSA P-256；协商：ECDH P-256。
- 会话密钥：HKDF-SHA256，salt 包含双方排序后的 ID，info 绑定 `aes-256-gcm`。
- 每条消息随机 12 字节 IV；AES-256-GCM 认证加密。
- 文件分片独立加密，接收端校验分片齐全后重组；不完整会拒绝并提示重试。
- 私钥只存在本机 IndexedDB；导出身份备份时请当密码保管。

## 构建

### Web

```bash
npm run test:all
```

### Android APK

需要 JDK 21 + Android SDK 35（本仓库开发环境在 `toolchain/`，已加入 `.gitignore`）。

```bash
npm run native:web
npm run native:sync
npm run android:release
```

输出：`android/app/build/outputs/apk/release/app-release.apk`。

### Windows EXE

```bash
npm run dist:win
```

输出：`dist/MonetChat-Setup-1.2.0.exe` 与 `dist/MonetChat-Portable-1.2.0.exe`。

### Linux

```bash
npm run dist:linux
```

输出：`release/MonetChat-1.2.0-linux-x64.tar.gz`。

### macOS / iOS

见 [`macos/README.md`](macos/README.md)、[`ios/README.md`](ios/README.md)。两者必须在 Mac + Xcode 上构建、签名。

## 测试

```bash
npm run test:all
npm run test:electron
npm run test:tablet
```

覆盖：双端文本/表情/图片/文件、大图转文件手动接收、群聊 3 人 fanout、音频/视频通话、搜索/回应/回复/置顶、资料同步、安全码、语音、编辑、删除、离线补发、PWA 离线、平板双栏/手机单栏、EXE 打包运行。

## 已知限制

- **P2P 不等于无服务器**：仍需信令服务器做房间发现与 NAT 穿透；消息和文件不经过服务器。
- **离线补发仅限当前页面生命周期**：双方都离线时没有第三方存储转发；需要真正离线消息请部署常驻中继。
- **群聊为全互联 mesh**：人数越多上行压力越大，上限 12 人。
- **静态 ECDH 无前向保密**：会话密钥由长期 ECDH 密钥派生；高安全场景建议后续加入双棘轮。
- **远端直连依赖 NAT**：对称 NAT/部分运营商需要 TURN；设置里可填 TURN。
- **临时公网地址每次重启都变**：没装 Tailscale 时才会发生；装好并登录 Tailscale 后是永久地址。
- **EXE 未做代码签名**：SmartScreen 会提示未知发布者。
- **iOS**：PWA 对后台通话、通知和文件保存限制较多，建议用 Android/桌面。

## 隐私

- 服务器只看到：房间码、成员公钥资料、SDP/ICE、在线状态、连接时间。
- 服务器看不到：消息文本、图片/文件内容、通话媒体。
- 本地数据可用设置里的「导出全部」备份；清除浏览器数据会丢失身份和记录。

## 许可

MIT，见 [LICENSE](LICENSE)。
