# Throwaway — Week 9 实现计划

日期：2026-10-05（Australia/Sydney）  
状态：供 Claude 执行的详细实现计划与视觉参考；本文件不代表已经实现、测试或部署。  
范围：COMP8020 C8 / Week 9「It's alive!」的第一版可运行项目。

## 1. 本周目标与成功标准

Throwaway 是一个匿名共享空间，让人把一直携带的念头写在纸上，揉皱、扔下，再偶然遇见别人留下的纸。

本周只实现：**进入公共空间 → 写纸条 → 保存到服务器 → 揉皱并扔入空间 → 展开阅读 → 刷新或再次访问后纸仍存在**。

必须能证明：陌生访客无需注册即可使用；浏览器 A 创建的纸条能被浏览器 B 在刷新后遇见和展开；纸条在服务重启和重新部署后仍存在。一次页面内的动画或 localStorage 中的记录都不算持久化完成。

课程 C8 的正式要求包括 Fly 部署、可再次遇见的痕迹、第一版 Definition of Good、过程记录和反思；实时层与视觉精修可以后续完成。来源：[C8 正式说明](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/crits/08-its-alive/)。

## 2. 已确定的输入与实施假设

- 产品依据：[用户设计过程与最终描述](https://chatgpt.com/share/6ac39a5c-ca44-83ec-b582-ae042218c2a0)。
- 纸团实现依据：[paper-crumple-demo](https://github.com/item-develop/paper-crumple-demo)。复用 Three.js、cannon-es、VAT 模型及揉皱/展开/投掷交互；保留 MIT 许可证及原作者署名。
- 视觉方向：浅暖灰环境、米白纸张、炭灰文字、柔和阴影；概念图是氛围参考，纸团实际形态以 demo 为准。
- 第一版公共空间采用有边界的场景，不实现无限世界；局部坐标、碰撞和投掷轨迹只在客户端存在。
- 第一版文字界面采用英文，允许输入中文；正常显示用户的换行与标点。
- 以课程提供的 Final Project starter 为实施起点。当前目录中的 Assignment 2 文件不作为新项目代码基础，也不覆盖已有 plan.md；sources/ 保持只读。
- 实现开始前核实 starter、包管理器、课程检查入口、部署名称和实际截止时间。本计划不猜测具体仓库名称或 cutoff。
- 用户负责产品与视觉判断、真实 crit 反思和最终演示；实现代理负责按计划实现、检查并提供证据。这里的责任分配是后续安排，不是已发生的工作记录。

## 3. 范围边界

### 必须交付

| 项目 | Week 9 行为 | 完成证据 |
|---|---|---|
| 公共空间首页 | 打开 / 即看到真实数据库中的纸团；空库有清晰写作入口 | 两个独立浏览器访问 |
| 匿名会话 | 服务器分配匿名身份，同一浏览器刷新后保持 | 服务端会话检查 |
| 写纸条 | 输入原文、明确确认、提交；成功后内容不可编辑 | 成功及失败流程检查 |
| 真实持久化 | SQLite 数据位于 Fly 持久卷 | 刷新、重启、重新部署后的同一纸条 |
| 共享遇见 | B 刷新空间后能遇见 A 创建的纸团 | 两浏览器演示 |
| 展开阅读 | 主动点击后读取原文；关闭后回到空间 | 中英文及长文本检查 |
| 当前总数 | 显示数据库现存纸条总数，创建后更新；其他浏览器刷新更新 | 接口与页面数量一致 |
| 纸团 demo 集成 | 真实纸条对应真实 ID；可点击展开/收起；新纸有基础揉皱/投掷过渡 | 动画与数据库 ID 一致 |
| 课程交付 | Fly URL、/readme/、README、PROCESS、crit-8 反思、课程检查 | 部署访问、文件与检查记录 |

### 明确延后

不安装或实现 Socket.IO / WebSocket，不做实时通知、见证人数、I saw it、Keep / Release 权限、焚烧、最后阅读状态、恢复码、举报、AI 审核、Orphaned Gallery、AI 象征物、环境音或无限空间加载。

第一版也不提供评论、点赞、搜索、热门排序、个人历史、My Papers 或编辑入口。不要为尚未实现的功能放置可点击按钮或空页面。

Keep / Release 是最终产品的重要选择，但本周没有销毁机制，因此不展示这两个选项，也不声称已实现其权限。README 应说明这是早期版本，当前纸条可被陌生人阅读且持续保留，不提供个人找回列表。

## 4. 技术方案

| 层 | 选择 | 用途与约束 |
|---|---|---|
| 前端 | React + TypeScript + Vite | 管理写作、阅读、加载和失败状态；适配 starter 已有约定 |
| 场景 | demo 原生 Three.js + cannon-es + VAT | 保留现有实现，封装场景初始化、事件和销毁；不迁移到 React Three Fiber |
| 样式 | CSS Modules / CSS 变量 | 小型统一样式系统；无需完整组件库 |
| 后端 | Node.js + Express + TypeScript | 同源提供 API、前端产物及 README 路由 |
| 数据 | SQLite + better-sqlite3 | 最小数据表、参数化查询、创建事务 |
| 部署 | Fly 单实例 + 持久卷 | 数据库路径例如 /data/throwaway.sqlite；运行时挂载目录初始化 |

若 starter 已有等价可用结构，沿用而非强制重建。第三方前端依赖通过项目包管理器固定版本，VAT 资产随项目部署；不依赖 demo 网站在线运行。

React 管 HTML 输入框、正文与按钮；Three.js 管模型和动态效果。模型移动和逐帧物理计算不放入 React state。页面退出时释放场景资源与事件监听，避免重复挂载产生多个动画循环。

SQLite + 单实例适用于本周原型，部署期间允许短暂中断；不代表高可用生产系统。持久卷不能自动跨实例共享或复制，需要独立备份。来源：[Fly Volumes](https://docs.fly.io/volumes/overview)。

## 5. 最小数据与接口

### 数据

- identities：id、created_at。只用于服务器识别匿名访客，不公开作者身份。
- sessions：会话凭据的摘要、identity_id、expires_at。凭据由服务器随机生成，通过 HttpOnly Cookie 传递；不接受客户端自报 owner_id。
- papers：id、owner_identity_id、content、created_at、submission_key；对 owner_identity_id + submission_key 建唯一约束，用于同一次提交的安全重试。

不预建见证、焚烧、恢复码、gallery 或审核表。创建后不提供编辑或删除接口；这就是本周的不可编辑边界。

### 接口行为

| 接口 | 最小职责 |
|---|---|
| POST /api/session | 已有有效会话则复用，否则建立匿名会话 |
| GET /api/papers | 返回随机纸团 ID 和 total；不返回正文或作者身份 |
| GET /api/papers/:id | 主动打开时返回正文；不存在返回明确状态 |
| POST /api/papers | 根据会话写入 paper，返回新 ID 和更新后的 total |

约束：拒绝空白文本；先采用 2,000 Unicode 码点上限并在输入处说明；原文按纯文本显示，不解析用户 HTML。客户端保持草稿，保存失败不得清空。按钮在提交期间禁用，同一次提交的网络重试复用 submission_key，服务端返回已有结果，避免保存成功但响应丢失时重复创建。

随机窗口初始最多渲染 12 张纸（本计划的起始参数，不是课程要求）。总数独立查询，不等于屏幕纸团数量。验收时使用少于 12 张的测试库，确保第二个浏览器能找到演示纸条。自建成功后把该 ID 加入当前本地窗口，但不保存个人历史。

## 6. 页面与交互规格

### 首页 /

- 直接进入浅暖灰公共空间，没有独立宣传首页。
- 左上 Throwaway；右上 About / Readme 链接，直接指向 /readme/；底部当前数量和 Leave something here。
- 首次简短说明：Open a paper. Leave something if you want to.
- 未展开纸团使用中性纸面，不能通过 demo 的彩色印刷内容或纹理泄露用户正文。
- 第一版沿用有限场景：点击展开、拖纸团拾取。空白处拖动探索留到后续，避免与 demo 操作冲突。
- 没有纸条时显示 No papers are here yet.，并保留写作按钮；不生成假投稿或假总数。总数文案对 1 使用 thing，其余使用 things。

### 写作状态

- 中央平整纸张上放 HTML textarea，提示 What are you ready to put down?。
- 展示：This paper will be readable by strangers. Once thrown, it cannot be edited or retrieved from a personal history.
- 唯一提交动作 Crumple & throw；另有 Cancel。没有 Keep / Release。
- 顺序：确认提交 → 服务器保存成功 → 揉皱与投掷 → 回到公共空间。
- pending 时保留文字；失败时允许重试或取消。只有保存成功才能清空草稿。
- 若动画失败但保存已成功，显示已保存结果并刷新空间，不引导再次提交。

### 阅读状态

- 点击纸团时请求原文，同时播放展开；加载失败可关闭或重试。
- 正文使用可选择的 HTML 文本，长文在纸面内滚动；不把整段文字仅绘入 Canvas 纹理。
- 阅读时背景降低存在感；提供 Close，返回同一公共空间。
- 不显示见证人数、作者、删除、举报或分享操作。

### 桌面与手机

- 检查课程视口 1920×1080 与 390×844。
- 手机用点击完成写作和投掷，不要求甩动手势；输入时能看见提交按钮。
- 按钮有足够触摸面积；纸团稀疏摆放；阅读正文不横向溢出。
- 场景触控与正文滚动分离；打开阅读时不误拾取背景纸团。
- 手机先限制像素比和场景数量，必要时关闭 SSAO；参数以真实浏览器检查决定，不预先宣称流畅。
- WebGL 不可用或 VAT 失败时提供明确错误与重试，不持续显示 loading。

## 7. 分阶段实施与验收

每个阶段完成后再进入下一阶段；实现代理交付证据，用户判断产品是否符合意图。

| 阶段 | 具体动作 | 交付物 | 验收门槛 |
|---|---|---|---|
| 0：基线 | 检查课程 starter、AGENTS、已有检查、运行和部署约定；记录选型 | 实际仓库信息、简短技术决策 | 原有 / 与 /readme/ 检查可运行；未覆盖原课程文件 |
| 1：持久化 | 实现匿名会话、SQLite 初始化、创建/随机读取/详情接口 | 最小后端及数据库检查 | 空白被拒绝；原文不变；重启后 ID 和内容仍在 |
| 2：真实界面 | 实现首页、写作、阅读及失败状态，先接通真实数据 | 可操作的完整闭环 | A 写、B 刷新后读；无 mock 正文、假数量 |
| 3：demo 接入 | 复用模型与动画，把纸团绑定数据库 ID；调整颜色、正文遮罩与 HTML 阅读层 | 纸团场景与许可记录 | 无泄露正文；保存成功才投掷；关闭不删除；手机可操作 |
| 4：Fly 验证 | 单实例部署，挂载持久卷，核对资产路径与 API | 实际 *.fly.dev 地址 | 同一纸条在刷新、服务重启、重新部署后仍能打开 |
| 5：交付材料 | 更新 README、PROCESS、真实反思；运行课程及产品检查 | 文档、检查结果、演示证据 | /readme/ 与 README 一致；检查通过；实际线上双浏览器演示完成 |

保持随工作增长的小提交；提交、push、部署及公开操作应遵循后续实际执行时的用户授权和课程工具流程，本文件本身不执行这些操作。

## 8. 必要检查与证据

自动化重点验证业务事实，不编写只复述组件实现的测试：

1. 创建并读取：中英文、换行、标点与提交原文一致。
2. 输入边界：空白和超过已公布上限的内容不会写入，数量不变。
3. 持久化：关闭并重新打开数据库连接后，同一 ID 与内容仍存在。
4. 匿名会话：有效凭据复用；新浏览器产生不同身份；请求不能指定他人的 owner。
5. 数量与内容边界：列表 total 与实际行数一致，列表没有正文和公开身份字段。
6. 保留 starter 自带检查；为 HTML 表单、阅读与按钮检查标签、键盘操作、焦点返回和可访问性。

线上人工检查必须覆盖：

- 浏览器 A 新建匿名会话，提交一条不含私人信息的演示文本；记录 paper ID。
- 浏览器 B 使用独立会话访问并刷新，展开相同 paper ID，读到相同原文。
- A/B 刷新后总数正确；不要求自动实时变化。
- 服务重启，再次读取同一 ID；重新部署后再重复读取。
- 1920×1080 和 390×844 上完成写作、展开、长文阅读与关闭；保存失败时草稿保留。
- 浏览器控制台无影响核心流程的错误，VAT/模型/前端资源均从部署应用成功加载。

记录实际执行时间、部署版本、步骤、结果和证据路径。未运行的检查写“未验证”，不能把本地通过当作 Fly 持久化通过。

## 9. Week 9 文档与演示

README.md：基于已有第一版写清产品目的、何谓 good、主动遇见与不可编辑的原则，注明当前仅是 Week 9 slice；引用实际读过的材料和 demo。保留约 400–600 英文词的课程指导范围，避免把未实现功能描述成现状。

PROCESS.md：记录选择此技术栈的理由、demo 复用边界、一次关键纠正、检查及部署证据。记录真实动作，不预写“成功”过程。

reflections/crit-8.md：由用户确认实际突破与学到的内容后完成，不能虚构个人体验。

课程要求最终项目仓库在本周 cutoff 公开并保持公开；按 starter/课程流程核对实际状态，本计划不改变仓库可见性。课程材料：[Assessment](https://comp.anu.edu.au/courses/comp4020-agentic-coding-studio/topics/assessment/)。

建议 crit 演示顺序：打开 /readme/ 说明一个 good 原则 → 进入真实空间 → 写下演示文本并投掷 → 在第二浏览器刷新并展开 → 展示重启/部署后的持久化证据 → 明确说明实时、见证与焚烧尚未实现。

## 10. 完成清单与停止规则

- [ ] Fly 线上 / 可用。
- [ ] /readme/ 发布真实 README。
- [ ] 陌生访客无需注册可写一张纸。
- [ ] 真实数据库保存成功后才呈现投掷完成。
- [ ] 第二浏览器刷新后可遇见并展开同一张纸。
- [ ] 刷新、服务重启、重新部署后内容仍存在。
- [ ] 当前数量来自数据库。
- [ ] 纸条无编辑、个人历史或搜索入口。
- [ ] 纸团 demo 许可与来源被保留和说明。
- [ ] 桌面与手机核心闭环通过检查。
- [ ] starter 检查及必要业务检查通过。
- [ ] PROCESS 与 crit-8 反思记录真实过程。
- [ ] 课程要求的公开状态与交付流程已核对。

上述门槛完成即停止 Week 9 扩展。允许剩余时间调整间距、光照和基础动画；不开始 Week 10 实时系统或 Final 的权限与销毁功能。

## 11. Claude 开工指令与信息优先级

请实现本文件定义的 Throwaway Week 9 slice。先读取实际 Final Project 仓库的 AGENTS.md、README、package.json、starter 路由、课程检查及部署配置；列出你发现的约束，再按第 7 节依次推进。不要把本设计目录当作已存在的产品仓库。

执行顺序：**项目真实约束 → 本文件的 Week 9 功能和文字规范 → 对应独立参考图 → demo 的视觉与动画机制**。旧的四宫格概念图含 Keep / Release、见证与恢复码，已经不适用于 Week 9，不得照旧图添加功能。

这些新图是设计参考，不是已经实现的页面截图。图上的纸条文字和数字是明确的演示样例；上线必须使用真实数据库数据，绝不能为了截图一致而硬编码样例。

图片与文字若冲突：以本文件的功能范围和固定控件文案为准。生成图中的纹理或模型外形无法由 demo 精确重现时，保留 demo 真实模型，并记录差异；不要重新发明揉纸算法。除此之外不随意更换布局、颜色、按钮、字体层级或增加装饰。

## 12. 网页、状态与参考图对应表

所有新图位于 `throwaway-week9/design-references/`。每个文件是一张独立完整界面，不是从旧图裁切的局部。

| 编号 | 实际 URL / 状态 | Claude 要实现的内容 | 视觉参考 |
|---|---|---|---|
| D01 | /，space | 全屏场景、固定页眉、底部总数/写作按钮/提示 | [01-home-desktop.png](throwaway-week9/design-references/01-home-desktop.png) |
| D02 | /，writing | 中央纸面表单、textarea、字数、公开与不可找回说明、Cancel/提交 | [02-write-desktop.png](throwaway-week9/design-references/02-write-desktop.png) |
| D03 | /，reading | 真实纸团展开、HTML 原文、Close、底部静默说明 | [03-read-desktop.png](throwaway-week9/design-references/03-read-desktop.png) |
| D04 | /readme/ | HTML 文章，实际 README 的完整内容与引用，返回空间 | [04-readme-desktop.png](throwaway-week9/design-references/04-readme-desktop.png) |
| M01 | /，space，手机 | 同一场景按手机构图调整，底部竖向控件 | [05-home-mobile.png](throwaway-week9/design-references/05-home-mobile.png) |
| M02 | /，writing，手机 | 单列可滚动纸面表单，输入与按钮不被键盘遮挡 | [06-write-mobile.png](throwaway-week9/design-references/06-write-mobile.png) |
| M03 | /，reading，手机 | 近满宽纸面，长文滚动，Close 容易触达 | [07-read-mobile.png](throwaway-week9/design-references/07-read-mobile.png) |
| M04 | /readme/，手机 | 单列文章首屏，内容正常延续到下方 | [08-readme-mobile.png](throwaway-week9/design-references/08-readme-mobile.png) |

只有两个网页路由：`/` 与 `/readme/`。写作/阅读是首页状态，不新增 `/write`、`/paper/:id`、个人主页或纸条分享链接。手机 /readme/ 对照 M04，沿用 D04 的文章结构，左右 padding 20–24px、正文单列、正常页面滚动，无需 3D 场景。

README 图的段落是版式样例，Claude 必须使用用户定稿 README，补上准确的 Week 9 实现范围与来源，不把图片中的短文当完整课程交付。

## 13. 每一部分的实施职责与技术栈

### 13.1 AppShell / 首页框架

技术栈：React、TypeScript、CSS Modules。参考 D01、M01。

Claude 要做：

1. 用一个 AppShell 组合 Header、PaperScene、SpaceFooter、WriteDialog、ReadDialog；App 只负责组合和顶层状态，不写成一个大型组件。
2. 定义 `space | writing | submitting | reading` 的最小状态，场景自己的 opening/closing/throwing 不混入业务权限。
3. 初次加载先建立匿名会话，再请求纸团窗口和 total；并行加载 VAT 资产，只有这两部分都就绪才允许完整交互。
4. 用户切换 dialog 时隐藏/禁用首页底部操作，避免出现两层相互竞争的提交按钮；页眉视觉保留，弹窗期间背景控件不接受焦点。
5. 右上 About / Readme 是真正的 /readme/ 链接；不增加独立 About 页面。
6. 场景是有限舞台。页面层不注册“拖空白区域移动相机”，也不显示 Drag to wander 提示。
7. 客户端 total 来自 API；创建成功使用服务器返回的新 total；重新访问首页重新加载。无需轮询或实时连接。

### 13.2 PaperScene / 纸团适配

技术栈：原生 Three.js、cannon-es、FBXLoader、EXRLoader、demo VAT 数据。参考 D01/D03/M01/M03；揉皱/展开/投掷过程以 demo 为准。

核心源码与参考链接：

- [GitHub 仓库](https://github.com/item-develop/paper-crumple-demo)
- [在线 demo](https://paper-crumple-demo.pages.dev/)
- [main-vat.js：场景和交互](https://github.com/item-develop/paper-crumple-demo/blob/main/src/main-vat.js)
- [paper-vat.js：资产加载](https://github.com/item-develop/paper-crumple-demo/blob/main/src/paper-vat.js)
- [paper.js：纸面材质](https://github.com/item-develop/paper-crumple-demo/blob/main/src/paper.js)
- [vat 资产目录](https://github.com/item-develop/paper-crumple-demo/tree/main/vat)
- [MIT LICENSE](https://github.com/item-develop/paper-crumple-demo/blob/main/LICENSE)

Claude 要做：

1. 先阅读仓库三个源文件，在第三方说明中记录实际复用 commit；从官方仓库取对应文件和 VAT，保留版权说明。
2. 把 demo 的“入口自动启动代码”改成可初始化、可销毁的场景模块。无需重写加载解码、法线、碰撞半径或 VAT 帧插值。
3. 从硬编码 PAPER_DESIGNS 改成由真实 paper ID 驱动。维护 ID 到 mesh/body 的映射，不把纸团数组下标当数据库 ID。
4. 去掉 demo 的虚构品牌、链接、缩略图、彩色纹理和调试 GUI；只改产品需要的部分，保留纸张几何和动态机制。
5. 场景中的纸张材质不含用户文字。正文只在主动打开后获取并显示；不能先把所有原文渲染进纹理然后声称未展开不可见。
6. 资源放到同源 `public/vat/`，配置 Vite 下实际能访问的基路径；示例文件为 `geo/vertex_animation_textures1_mesh.fbx`、`tex/vertex_animation_textures1_pos.exr`，最终按取到的目录核对。
7. VAT 只加载与解码一次。用原版已有缓存方式或简单共享加载结果，不为每张纸再次下载和解析 FBX/EXR。
8. 用数据库窗口初始化数量，删除 demo 固定生成 40 张纸的逻辑；空库必须为 0。
9. 点击纸团回调 onPaperOpen(id)，把打开的纸移向镜头并正向展开；正文对齐纸面内的安全区域。
10. 新建纸条保存成功后，用独立的前景纸过渡到 crumpled 状态，再加入对应真实 ID 的动态刚体；避免先生成无 ID 假纸再补存。
11. 所有位置、速度、相机与物理状态只保存在场景内；不要在 requestAnimationFrame 内反复 setState。
12. dispose 时停止动画循环、取消监听、移除 canvas、释放当前模块拥有的 geometry/material/texture/render target；共享资产不要重复释放。
13. 手机先使用较少可见纸团、受限 devicePixelRatio；对 SSAO 与阴影成本做实测后调整。不要把桌面的 40 张纸和全设备像素比原样搬到手机。

只暴露必要的模块能力，例如 `setPapers(ids)`、`openPaper(id)`、`closePaper()`、`throwCreatedPaper(id)`、`resize()`、`dispose()`；命名可沿用仓库约定。不要为单次使用建立通用游戏引擎或插件系统。

### 13.3 WriteDialog / 写作与提交

技术栈：React 原生 form/textarea、CSS、fetch；动画沿用 PaperScene。参考 D02、M02。

Claude 要做：

1. 把标题、textarea、字符数、提示和按钮作为真正 HTML，不生成整张表单背景图代替交互。
2. 输入不自动改写或分析。前后端统一用 Unicode 码点数计数：`Array.from(content).length`；上限 2,000，空白校验只用于判断，不 trim 后再存。
3. textarea 初始内容为空，placeholder 为 Write something you have been carrying.；不得自动填入示例念头。
4. Cancel 未提交时回到空间；本周不保存跨页面草稿。提交失败则在当前 dialog 内保留草稿。
5. 点击 Crumple & throw 时生成 submission_key 并发送；网络重试使用同一 key，用户改写成新内容后才产生新 key。
6. pending 时禁用重复提交，并把按钮文案改为 Saving…；避免仍可修改本次请求正文。
7. 成功返回 paper ID 后再播放投掷，清空草稿并回到空间；不能把取消或关闭表单当作“揉皱后自动发布”。
8. 错误提示紧贴表单底部，不增加全站通知中心；手机输入时纸面容器能滚动到按钮。

固定文字：What are you ready to put down? / Write something you have been carrying. / This paper will be readable by strangers. / Once thrown, it cannot be edited or retrieved from a personal history. / Cancel / Crumple & throw。

### 13.4 ReadDialog / 主动阅读

技术栈：React HTML 文本层、CSS、fetch；Three.js 只管理纸面变形。参考 D03、M03。

Claude 要做：

1. 对已选 ID 请求详情；暂时显示 Opening paper…，获取成功后用原文替换。
2. 正文用 `white-space: pre-wrap` 与安全的文本渲染，不使用 dangerouslySetInnerHTML。保留中英文、换行与长单词换行。
3. 让文字层在模型展开完成后出现，收起前隐藏；不要让 HTML 文字跟着几何折叠产生不可信的变形。
4. 使用 face-on 的展开姿态，减少角度导致 HTML 与纸面不对齐；文字层 padding 依可用纸面调整。
5. 内容过长仅滚动阅读区域；Close 固定在容易看到的位置，底部显示 Someone left this here.。它是产品文案，不代表已做身份识别。
6. Close 收起纸团且不改数据库；Escape 同样关闭并把焦点返回触发对象或空间的可访问入口。
7. 详情读取失败显示无法打开和重试/关闭；不展示 demo 原有品牌卡片作为 fallback。
8. 没有 I saw it、计数、焚烧、Keep/Release、举报、作者或日期。

### 13.5 ReadmePage / 课程材料页面

技术栈：starter 现有 README 发布方式；若需要样式则用普通 HTML/CSS，Markdown 内容仍由 README.md 产生。参考 D04、M04。

Claude 要做：

1. 优先保留 starter 的 /readme/ 路由和文件读取方式，不创建第二份容易漂移的 React 文案。
2. 调整外层为统一页眉 + 760px 阅读栏；正文采用清晰无衬线字体，H1 可用品牌衬线。
3. 顶部 Back to the space 指向 /；没有场景、Canvas 或纸团动画，不加载整套 WebGL 依赖。
4. 实际 README 包含现状、Definition of Good、明确缺席的社交功能、可检查的性质与参考材料；未实现功能用 future wording。
5. 长文章正常滚动；手机窄屏不保留桌面固定宽度；引用链接可点击并有焦点状态。

### 13.6 API / 匿名身份 / SQLite

技术栈：Express、Node crypto、better-sqlite3、TypeScript；无 Socket.IO。没有对应视觉图，按第 5 节契约实现。

Claude 要做：

1. Node 服务提供前端静态产物与 /api/*，避免本周引入多个部署服务；开发阶段使用 Vite proxy。
2. 会话 cookie 含高熵随机凭据；服务端保存摘要，按摘要查匿名身份。部署设 Secure、HttpOnly、SameSite=Lax；本地 HTTP 按开发环境调整 Secure。
3. POST /api/session 可重复调用而不反复换身份。无邮箱、注册、用户名或公开身份字段。
4. POST /api/papers 请求只有 content 与 submission_key；owner 从有效会话取，不信任客户端 owner 字段。
5. JSON 响应采用明确结构：列表 `{ papers: [{ id }], total }`，详情 `{ id, content }`，创建 `{ paper: { id }, total }`。创建重复重试返回同一 ID，不增加 total。
6. 写入和重复 submission_key 判断以 SQLite 唯一约束为事实；数据库查询参数化。创建与相关计数放在同一短事务中。
7. GET 列表随机返回 bounded subset，不按创建时间/人气排序。服务器固定上限 12，不开放任意无界 limit。
8. 只有 id 和正文按需要对客户端暴露；不返回会话摘要、owner_identity_id 或个人 paper 列表。
9. 错误按语义处理：400 输入错误、401 无有效会话、404 无该纸、500 服务失败；不向客户端暴露 SQL、堆栈或凭据。
10. 日志只记录必要事件和 paper ID，不记录正文、cookie 或恢复码。完整可观测性系统留到后续。
11. 暂不建 PATCH/DELETE/搜索/个人历史接口，不为未来 Final 先设计完整权限模型。

### 13.7 Fly / 构建与课程检查

技术栈：starter Docker/Fly 配置、Node 运行时、Fly Volume；课程既有检查，加必要后端业务测试和浏览器检查。

Claude 要做：

1. Node 监听 Fly 需要的地址和端口；Docker 构建前端与服务端，运行镜像包含产物、README 和 VAT。
2. 运行时而非镜像构建时打开 /data/throwaway.sqlite；挂载 volume 后幂等初始化表。
3. 单实例部署，避免每个实例各有独立 SQLite 造成共享空间分裂；不增加 Redis、分布式同步或 Kubernetes。
4. 保留课程固定 URL 与 checks。核对 /readme/ 和 / 在部署环境实际响应，不只验证本地。
5. 验证 volume 挂载与数据库实际路径；展示同一 paper ID 在重启及重新部署后存在，不用重建 seed 数据伪造存活。
6. 记录备份方式与单实例限制即可，本周不实现多区域容灾。

## 14. 最小目录建议

在课程 starter 中按现有布局映射；不要为了这个示意目录进行大规模搬迁。

```text
src/
  App.tsx
  components/          # Header、SpaceFooter、WriteDialog、ReadDialog
  scene/               # PaperScene 包装及 demo 来源文件
  lib/api.ts           # 少量共享 fetch 调用
  styles/              # tokens 与共用布局
server/                # 服务入口、session、papers、db
public/vat/            # 官方模型与 EXR，目录结构保留
spec/                  # 课程检查 + 必要业务检查，沿用 starter
README.md
PROCESS.md
CLAUDE.md              # 写清本周范围、运行与检查方式
reflections/crit-8.md
THIRD_PARTY_NOTICES.md  # 来源、复用 commit、MIT 许可
```

不要另建数据库 repository 层、通用状态框架、事件总线、主题系统或未来功能目录。React 本地 state / ref 足够；无需 Redux/Zustand，也不额外加入 GSAP 取代 demo 自有动画。

## 15. 视觉规格与核对方式

初始实现 tokens：环境 #E7E4DE，纸面 #F3F0E8，文字/主按钮 #292927，次级文字 #5C5A55；这些是意图值，最终以独立参考图的色彩和可读性校验。不要改成红墙、彩色纸、霓虹或渐变。

- 字标：Georgia 或接近的现有衬线字体；桌面约 32px，手机约 26px。
- UI 与正文：系统 sans-serif，含中文系统回退；桌面正文 18–20px，手机最低 16px。D02/M02 写作标题使用与字标一致的衬线字体；README H1 也是衬线，小标题与正文用 sans-serif。
- 桌面页眉边距约 48px；手机 20px。主按钮 52px 高、6px 圆角、明确焦点。
- 公共场景无卡片框、没有全屏大圆角容器；参考图的外边缘就是浏览器 viewport。
- 纸团位置随机，不要求与图逐点相同；必须保持负空间、密度、纸面颜色、柔和阴影与控件避让。
- desktop 图是 16:9 比例参考；mobile 图是约 390:844 比例参考。具体生成像素尺寸见图索引；最终浏览器仍按课程 1920×1080、390×844 验收。

每次只核对正在实现的状态与它对应的图，不用一张首页图评价全部状态。至少比较：页眉、正文/按钮字号、纸面占比、主按钮位置、背景颜色、阴影、长文和手机溢出。

最后输出实际浏览器截图与对照记录：功能测试通过不代表视觉通过；参考图不是部署证据。对字体、模型外形或长文产生的必要差异说明原因，不笼统写“完全一致”。

## 16. 给 Claude 的阶段交接要求

每阶段结束报告四项：改了什么、对应哪张参考图、实际跑过什么检查、还有什么未验证。遇到功能范围冲突先按 Week 9 范围收敛，不能自行添加 Final 功能。

最终交接给用户应包括：真实 Fly URL、最后提交/部署版本、桌面和手机三个核心状态的截图、同一 paper ID 的跨会话与持久化证据、课程检查结果、README/PROCESS/crit-8 反思路径、第三方来源、剩余限制。

完成本计划的检查清单后停止；下一周工作必须作为新范围单独计划。

## 17. 容易遗漏的实现细节

- 场景是一个绘图表面，不是整个网页：Header、数字、按钮、输入与正文保持 HTML；不把参考 PNG 当作页面背景或截图式 UI。
- 若没有额外深度模糊实现，dialog 状态通过背景半透明遮罩与停止背景交互弱化纸团；参考图的背景虚化属于视觉意图，本周不为它新增后处理管线。
- 写作标题样式按 D02/M02；textarea 有轻微边框。第一版建议输入面与阅读面用简单矩形安全区域，纸张外轮廓由 demo 模型提供，不为了生成图中的纸边逐点修改 VAT 模型。
- 模型展开后 HTML 与纸面对齐以实际 mesh 包围盒和镜头投影为准，不将 desktop 的像素绝对位置直接复制到手机。正文溢出时优先滚动文本区域，不拉伸纸张或缩小字号。
- 首页每个可打开的纸团要有可聚焦的 HTML 操作入口，例如贴合其屏幕投影位置的透明 button，aria-label 为 Open paper；可用键盘触发相同 onPaperOpen。不要只支持 WebGL 点击。
- 焦点锁定在当前 dialog 中，关闭返回原入口；背景控件不能穿透点击，触摸读文时不能移动背景模型。
- 手机最多显示 6 张纸，桌面最多 12 张；服务器返回最多 12 个 ID，客户端可按视口减少渲染，总数不变。这是有界渲染窗口，不是分页、个人历史或搜索。
- 用户完成写作后，可在当前窗口加入自己刚提交的 ID，并替换一个旧可见 ID；不保存长期“我的纸团”列表。
- submission_key 相同且同一 owner 重试必须对应同一正文；若 key 相同而正文不同，返回输入冲突而非静默忽略新内容。
- 对网络响应丢失的情况不能显示“已失败且未保存”断言；保留草稿并允许同 key 重试。确认存在后播放一次投掷。
- 示例截图中的 8 是总数样例，手机可见 5 张只是随机窗口样例；示例文字仅用于设计，不插入上线数据库。
- README 新版本完成后确保图中所示的 References 实际指向有效 URL；不把 public Share 对话当技术依赖或运行时资源。

## 18. 交付包的使用方法

将 `throwaway-week9-plan.md`、`CLAUDE-WEEK9-HANDOFF.md` 与 `throwaway-week9/design-references/` 一起放入实际 Final Project 仓库根目录，保持相对路径。先让 Claude 阅读交接说明，再按主计划推进。图片索引为 `throwaway-week9/design-references/README.md`。

本交付包仅包含计划与设计参考，不含产品代码、数据库、真实用户纸条或已部署应用；不要在 PROCESS 中把此处的设计输出写成已完成实现。
