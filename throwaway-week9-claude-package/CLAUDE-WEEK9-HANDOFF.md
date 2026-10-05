# 交给 Claude 的实施指令

请在课程提供的 Final Project starter 仓库中，实现 Throwaway 的 Week 9 / C8 第一版。

先读取本仓库 AGENTS.md 与现有 starter，再完整读取 `throwaway-week9-plan.md`。它是本次工作的功能、技术与验收契约；不得自行扩大到 Final 全功能。

随后逐张查看 `throwaway-week9/design-references/` 中的 8 张独立参考图，以及该目录的 README 图索引。它们分别对应首页、写作、阅读、README 的桌面与手机布局。旧四宫格图已不适用。

视觉模型与揉皱/展开/投掷采用用户指定仓库：https://github.com/item-develop/paper-crumple-demo 。先读 main-vat.js、paper-vat.js、paper.js，记录实际复用 commit，保留 MIT 许可。不要重写揉纸算法或用静态生成图替代纸团。

按主计划第 7 节顺序实现，每一阶段通过检查再继续。第 13 节列出每部分要做什么及技术栈。先实现真实会话、SQLite 持久化和跨浏览器纸条，再绑定纸团 demo；保存成功后才播放投掷。

只交付 `/` 与 `/readme/`。写作和阅读是首页内的状态。禁止添加 Keep/Release、Socket.IO、见证、焚烧、恢复码、举报、AI、无限世界、个人历史或社交功能。

用独立参考图逐状态对照：D01–D04 桌面，M01–M04 手机。模型外形沿用 demo；文字、按钮与正文使用真正 HTML。样例数字与纸条内容不能硬编码为产品数据。

完成时提供实际 Fly URL、版本、测试结果、桌面/手机截图、同一 paper ID 的跨会话及重启/重新部署持久化证据，以及 README/PROCESS/crit-8 反思。未验证的部分明确标注，不提前宣布部署或持久化完成。

现阶段计划与参考图不等于已实现功能。用户的真实反思不得编造，公开仓库、push 和部署按当前会话授权与课程流程执行。
