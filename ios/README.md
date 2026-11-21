# iOS / iPadOS 构建说明

`ios/` 是 Capacitor 生成的 Xcode 工程，已配置：

- Bundle ID：`com.monet.chat`
- 版本：`1.1.0`（build 2）
- 最低系统：iOS 14
- 相机、麦克风、相册、本地网络权限说明
- 允许局域网 HTTP 信令（ATS 例外）

Windows 无法编译或签名 iOS，需要在 Mac + Xcode 上完成。

## 生成并打开工程

```bash
cd monet-chat
npm install
npm run native:web
npx cap sync ios
open ios/App/App.xcworkspace
```

> 一定打开 `App.xcworkspace`，不要打开 `App.xcodeproj`；CocoaPods 依赖在 workspace 里。

## 真机测试

1. Xcode → 选中 `App` target → Signing & Capabilities。
2. Team 选择你的 Apple ID 团队，Bundle Identifier 改成自己的（例如 `com.yourname.monet`）。
3. 连接 iPhone/iPad，选择设备，Run。
4. 首次启动允许“本地网络”和“麦克风/相机”。
5. 在首次创建身份时填写信令服务器：`http://<Windows 局域网 IP>:4173`。
6. iPhone/iPad 与 Windows 电脑必须在同一 Wi-Fi；公司网络若隔离设备，用手机热点。

## iPad 布局

- 宽度 ≤ 680pt：手机单栏，聊天页全屏覆盖。
- 681–1100pt：平板双栏，左侧 300pt 朋友列表 + 右侧聊天。
- 横屏短高度也会切到单栏全屏，避免键盘把输入框挤没。

## 打包 / TestFlight

1. Xcode → Product → Archive。
2. Organizer → Distribute App → App Store Connect / Ad Hoc。
3. 需要 Apple Developer Program 账号与证书；没有账号只能做 7 天有效的个人签名真机调试。

## 注意

- iOS 上 WebRTC 的屏幕共享、后台音频受系统限制，视频通话退到后台会被暂停。
- `@capacitor/push-notifications` 未接入；当前没有离线推送，消息补发依赖对方重新上线。
- PWA 也可在 Safari 里“添加到主屏幕”，作为不签名的替代方案。
