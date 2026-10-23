# Catalina 兼容包：Mac 3.0 build 29

> 历史记录时点：2026-10-21 至 2026-10-22。本文的“当前”“最新”、部署状态、测试计数与待办均指对应记录时点，不代表 2026-10-23 的线上状态；本次整理未重新核对生产。

2026-10-22 状态：主开发树已撤回 Intel/旧 macOS 兼容实现，详见 [撤回记录](intel-retirement-2026-10-22.md)。下文保留原交付证据与冻结源码说明；其中兼容构建命令仅适用于对应归档源码。现有下载入口和安装包未变。

用户截图确认实际机器为 Intel MacBook Air 2017 / macOS Catalina 10.15.7。此前 build 28 最低 12.3，不能覆盖这台机器。本次明确扩展到 Intel x86_64 / macOS 10.15.7+。

## 交付与来源

安装包：`output/catalina-compat-v3.0/NotchSPI-3.0-build29-Intel-Catalina.dmg`。从已发布 build 27 冻结源码重新解包，验证原始 736 文件哈希，独立源码和完整差异证据位于同目录。698 个基线文件未改，38 个基线文件有兼容改动；新文件含旧系统桥接、测试、矢量图标与原版本 SwiftMath 的本地副本。不存在 Windows 共享代码。原答题协议、核心状态机、快捷键注册与设置存储等保持基线。

SwiftMath 1.7.3 的实现和字体保持原样，仅调整本地 manifest 的系统下限及 README 许可证链接。旧系统网络、Markdown 和绘制兼容层是新增适配，不宣称复杂 Markdown/系统控件/抗锯齿与新系统逐像素一致。具体边界和重建方式见交付目录 README。

## 验证

- Intel Release 明确编译到 10.15.7；DMG 内 Mach-O 和 Info.plist 一致，资源与 Swift 并发回部署库齐全。
- ScreenCaptureKit、ServiceManagement 为弱链接；包内无开发机工具链运行路径，无测试沙箱符号。
- 592 项 Swift 回归（强制旧网络和排版路径）：4 跳过，0 失败。6 项专项覆盖中文分片、流式取消、拒绝重定向、排版、旧绘制和测试网络隔离。
- 工程健康检查与 13 项工程检查器测试通过。Swift 测试在 Apple Silicon 主机运行；本机未安装 Rosetta，未运行 Intel 二进制。
- Developer ID 签名、Apple 公证 Accepted、票据装订和 Gatekeeper accepted 全部通过。公证 ID `7c1c6bed-dcde-47c5-999c-fe7c549bc0a4`。
- 最终 SHA-256：`48ef38436629ee0f9a9ff94fb18ea7320efb3914805ce6559bf95506ece507ce`，10,098,752 字节。

## 真机边界

用户仍需在 Catalina 实测启动、录屏权限、截图不包含自身、浏览器快捷键、连续答题、休眠恢复及第三方录屏。主机测试和公证不替代这些验收。Intel 版仍手动更新；macOS 13 以下手动添加登录启动。官网/GitHub/夸克现有包本轮未替换。
