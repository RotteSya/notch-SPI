# Intel 兼容版发布（2026-10-21）

> 历史记录时点：2026-10-21。本文的“当前”“最新”、部署状态、测试计数与待办均指对应记录时点，不代表 2026-10-23 的线上状态；本次整理未重新核对生产。

用户授权发布 GitHub 并新增官网 Intel 下载入口，保留正式版。

- GitHub：现有 v3.0 Release 新增 `NotchSPI-3.0-build28-Intel.dmg` 与 `SHA256SUMS-Intel.txt`，原 `NotchSPI.dmg` 与校验文件未替换，发布说明追加兼容要求。
- Intel：x86_64、macOS 12.3+，Developer ID 签名、公证与装订已验证。SHA256 `b365a4e5f5afe40b40870220b709ac81175e58e0b2fdafa33126ffbbb919bc8f`。
- 官网：https://notchspi-api.vercel.app/?lang=zh 。三语言首屏和页尾新增 `/dl/intel`，307 跳转固定 GitHub asset；原 `/dl` 保持 Apple Silicon/macOS 14+。标注 Intel 版手动更新。
- 部署：`dpl_71B75SR3aR6MxeUBF4bQj4hHCNcW`。上一生产 `dpl_5cU8saoLxi1rg7vtGfASWbfsAohP` 可回退。
- 从上一线上独立部署源复制；生产内容仅 `server/src/site.ts` 与 `server/vercel.json` 改变。未带入当前开发中的 Windows 或后端改动。
- 现有 CLI 授权失效，改用已连接 Vercel API 上传两份改动文件并引用其他现存文件摘要，生产构建 READY 且正式域名绑定成功。
- 服务端类型检查、21 项官网专项测试通过。浏览器确认中文双入口；三语言及两个下载文件的公开回读证据在 `../output/intel-publish-2026-10-21/`。
- Intel + macOS 12/13 真机验收仍未完成；发布、公证不替代硬件截图、快捷键和第三方录屏验收。
