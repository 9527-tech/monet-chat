# Linux 运行说明

发布文件：`release/MonetChat-1.1.0-linux-x64.tar.gz`（x64 便携版）

## 运行

```bash
tar -xzf MonetChat-1.1.0-linux-x64.tar.gz -C MonetChat
cd MonetChat
chmod +x monet-chat
./monet-chat
```

首次启动会在本机 `4173` 端口启动内置信令服务。手机连同一局域网后，在 APK 里填写 `http://<电脑局域网 IP>:4173`。

## 依赖

需要常见桌面库：

- Debian/Ubuntu：`sudo apt install libgtk-3-0 libnss3 libasound2 libgbm1`
- Fedora：`sudo dnf install gtk3 nss alsa-lib mesa-libgbm`
- Arch：`sudo pacman -S gtk3 nss alsa-lib mesa`

无桌面环境（纯 SSH）无法运行 Electron 窗口。

## 远程通道（可选）

Linux 包默认不带 `cloudflared`。安装后：

```bash
mkdir -p toolchain
ln -sf "$(which cloudflared)" toolchain/cloudflared
```

或：

```bash
CLOUDFLARED=/usr/local/bin/cloudflared ./monet-chat
```

没有 `cloudflared` 时，设置里的“公网远程通道”会明确提示不可用，局域网聊天不受影响。

## 自己构建

```bash
npm install
npm run native:web
npm run dist:linux
# 输出 dist-linux/linux-unpacked
```

要生成 AppImage/deb，建议直接在 Linux 上运行：

```bash
npx electron-builder --linux AppImage deb
```
