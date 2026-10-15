# 快捷键键帽边框裁切修复

此前实测第一排描边超出文字视图顶边约0.62pt、最后一排超出底边约0.93pt。Core Text测量文字，不包含自绘键帽向外延伸的2pt背景与0.5pt描边；首行paragraphSpacingBefore不能解决视图裁切。

StreamingAnswerView对含键帽的内容在上下各预留3pt，测量和绘制共用顶部偏移，保留答案卡原有留白。该段内容总高度增加6pt，面板沿现有自适应链路计算，无需增加滚动或点击。快捷键配置、自动提交和物理刘海安全布局未修改。

新增逐排几何回归：普通/卡片两种布局、320/568/760pt宽度、0.8/1/1.5/2倍测试字号，共24种组合，检查每个键帽含完整描边的上下左右边界均落在文档区域。默认四组快捷键均覆盖；测试从隔离配置读取，不改用户快捷键。

另用实际StreamingAnswerView离屏绘制检查全部四排圆角边框，输出 `/tmp/notch-keycaps-fixed.png`，首尾描边完整。此为原生绘制检查，不冒充实机屏幕截图。临时渲染测试已移除，保留几何回归。

日志：专项 `/tmp/notch-keycap-fix-tests.log`，完整 `/tmp/notch-keycap-full-tests.log`，本机构建 `/tmp/notch-keycap-build.log`。本轮不推送、不发版，不调用真实查题服务。

最终完整509项（4跳过、0失败）；arm64 Release构建和Developer ID签名验签通过。已启动正常本机包 `dist-qa/NotchSPI.app`，唯一实例PID58767，无QA参数，版本沿用2.17/24。
