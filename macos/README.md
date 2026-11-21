# macOS 构建说明

macOS 原生包必须在 Mac 上用 Xcode Command Line Tools 构建，Windows 上不能签名或生成可用的 `.app`。本目录只放平台说明，实际工程由 Electron 配置生成。

## 环境

- macOS 12+（Intel 或 Apple Silicon）
- Xcode 15+ / Command Line Tools：`xcode-select --install`
- Node.js 20+

## 构建未签名 .app / zip

```bash
cd monet-chat
npm install
npm run native:web
npm run dist:mac
```

输出在 `dist-mac/`：

- `mac/Monet Chat.app`（未签名，可本机运行）
- `MonetChat-1.1.0-mac-x64.zip`（未签名，分发给测试者）

首次打开未签名 app 时，右键 → 打开；或执行：

```bash
xattr -cr "Monet Chat.app"
open "Monet Chat.app"
```

## 正式分发

在 Apple Developer 账号下配置证书和公证：

```bash
export CSC_LINK=/path/to/developer-id.p12
export CSC_KEY_PASSWORD='证书密码'
export APPLE_ID='you@example.com'
export APPLE_APP_SPECIFIC_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='TEAMID'
npm run dist:mac
```

`electron-builder` 会签名并公证。未签名包在 Gatekeeper 下会被拦截，这是 macOS 的安全机制，不是应用故障。

## 远程通道（可选）

macOS 包默认不带 `cloudflared`。安装后：

```bash
brew install cloudflared
mkdir -p toolchain
ln -sf "$(which cloudflared)" toolchain/cloudflared
```

或启动时指定：

```bash
CLOUDFLARED=/opt/homebrew/bin/cloudflared open "Monet Chat.app"
```

没有 `cloudflared` 时，设置里的“公网远程通道”会明确提示不可用，局域网聊天不受影响。

## 架构

需要 Apple Silicon 原生包时，在 `scripts/build-mac.mjs` 里把 `Arch.x64` 换成 `Arch.arm64`，或将 `target` 配成 `['x64','arm64']` 构建 Universal 包。
