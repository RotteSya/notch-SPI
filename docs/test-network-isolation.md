# 测试网络隔离

工程入口见 [HANDOVER](../HANDOVER.md#验证与交付)。事实所有者为 `Package.swift`、`Tests/NetworkIsolation/TestNetworkIsolation.c`、`Sources/NotchSPI/App/DevelopmentIsolation.swift` 和 `OfficialAPI.swift`。

XCTest 目标必须链接 TestNetworkIsolation。C constructor 在测试执行前建立进程沙箱：拒绝公网，只允许回环，并拒绝系统及环境变量配置的代理端口；子进程继承限制，建立失败就终止测试。NSPI_QA_EPHEMERAL 只隔离凭证/存储，单独使用不能阻止生产网络。

DevelopmentIsolation 识别 XCTest 身份，官方请求只接受显式回环地址，否则回到无服务的 127.0.0.1:9；公开目的地在进入 URLSession 前拒绝。正常 App 不满足测试身份条件，服务行为保持原样。

隔离依赖只由测试目标引用，发行可执行文件不能链接它。运行历史冻结副本前必须核对同等隔离措施；不能根据当前仓库的通过结果推断旧副本安全。

sandbox API 已弃用；未来不受支持时保持失败关闭，再替换实现，不降级为联网测试。不修改用户系统网络、权限或代理设置。

验证为 NetworkIsolationTests、DevelopmentIsolationTests 和相关 transport 测试。真实截图、付费人格评测及 CPU benchmark 继续显式选择，常规验证不自动启用。历史事件与统计处理原文见[归档索引](history/index.json)。
