# 生产与直连请求构造的免费对照

第四版配对未证明提速，停止以性能名义推进该提示词。改为对照当前已冻结生产源码（dpl_6SdECThsrbnkc7mxYDXVWMwUNS5p）与直连基线实际序列化请求。

使用生产makeObjectiveProvider及officialScreenPrompt('general','zh',false)，参数为已观察到的deepseek-flash/low/32768；直连使用配对实验原基线模板及同六张冻结JPEG。只拦截fetch请求体，返回本地SSE用量夹具；系统sandbox-exec deny network*确保无外发，密钥固定offline-only。六题JSON对象深比较全部一致，含模型、max_tokens、stream_options、thinking/reasoning_effort、完整system/task、图像data URI。未打印或保存请求正文，仅摘要和字节数，见同名json。

首次直接导入candidate目录因缺sharp模块退出，未触网；改用此前已存在node_modules软链接的test目录。diff -qr证实两个目录src完全一致后才运行，不安装依赖、不修改冻结源码。成功对照是构造路径证据，不是线上payload抓包；端点取源码默认，当前线上端点覆盖值、账户、出口、排队和连接复用仍不由此证明。不能把不同日期实测差值归因于某个部署。

## 下一步测试版本准备

只修改/tmp/notchspi-daily-20261029/client三处：Capture/ScreenCapture.swift新增image.system.begin/end；Shared/SharedObjective.generated.swift同步已批准的本地语义兼容；App/LiveLatency.swift显式general并使用独立两次计数路径/tmp/notchspi-runtime-recheck-20261030/attempt-count。原文件备份在该目录。两次计数文件尚未创建，plan批准次数0，不能发起模型请求。

不改线上、模型、完整题图、推理强度、输出上限、账务或系统设置。Swift已有本地依赖构建通过5.46秒，沿用已有隔离App标识重新组装，ad-hoc签名严格验证通过；没有启动App或读取账户令牌。此前内存mock探针二进制已替换成恢复真实流程的诊断版本，不能混淆为mock性能。

拟Q9、Q11各一次真实客户端诊断：Q9是较慢完整题，Q11曾出现极慢/质量问题。新截图system区间区分主线程排队与系统调用，结合现有生产上游阶段。保持当前基线提示词，以CGEvent自动触发（须本批明确批准），最多扣2题，按原¥3/题预算预留¥6，无充值/重试/部署。此两题不是六题验收；收费请求及自动按键待授权。


## 2026-10-30 后续纠正：实际路由

后续使用同一账户只读GET /v1/client-config确认enabled_profiles仅reading_practice，测试客户端profile为general；NotchController因此将screenQuery置nil，OfficialAPI不携带screen_query_v1字段，服务端保留客户端旧objective提示词。先前基于指定screen-query分支的源码或离线请求构造核验，不能证明真实E2E使用该模板，也不能把候选部署前后的E2E差异归因于候选。原始计时/答案/扣题记录保留，解释以docs/latency-runtime-recheck-2026-10-30.md为准。
