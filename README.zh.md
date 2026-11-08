# Throwaway

一个共享的匿名空间，留给那些你准备好放下的事。

## 在这里，“好”意味着什么？

Throwaway 源于一种我熟悉的感受：一个念头或一种情绪憋在心里太久，想找个地方把它留下。
我为那些背负着一场没说完的对话、一份遗憾、一股怒气，或一个还说不清的念头的人，搭建了这个房间。
他们也许只来一次，也许会回来再留下一张纸，读读别人留下的东西。
他们可以写下心事，而不必把自己的名字系在这份情绪上。
在这里，“好”意味着给这份情绪一条出路，也给另一个人一次在其中认出自己的机会。

Robin Sloan 的[家庭通讯应用](https://www.robinsloan.com/notes/home-cooked-app/)
让我重新思考规模。Throwaway 向陌生人敞开，但哪怕只读一张纸，这次来访也可以是值得的。
我去掉了排行、评论、公开主页和搜索，好为这样的来访留出余地。
可选的账户能让你找回自己的纸，并在一个私密的视图里看到它们后来变成了什么。
没有观众，也就没有表演的理由。

在 [Popcannibal 的 Kind Words](https://popcannibal.itch.io/kindwords) 里，
陌生人用安慰或建议的信件回应匿名的求助。
我希望读者能表明自己用心读过，却不必要求写下它的人开启一段对话。
一张纸送到时是合着的。打开、读完之后，来访者只需按下“我看见了”。

我也不会筛选“有意思”的纸。一句简短、笨拙的话，也许正是某人需要放下的东西。
安全检查针对的是伤害，而不是给一个人的感受打分。纸张通过偶然的相遇出现。
Weiser 和 Brown 的
[The Coming Age of Calm Technology](https://calmtech.com/papers/coming-age-calm-technology)
提供了一种描述这个房间的方式：合着的纸停留在注意力的边缘，而打开一张，便把它带到眼前。

[Paper Crumple 演示](https://github.com/item-develop/paper-crumple-demo)
让我看到折叠和抛掷可以多么真实可感。我希望结尾也有同样的分量。
“留给自己”把焚烧的决定留给写下它的人。“放手”则把它交给见证过这张纸的人。
纸悬在火炉上方，直到有人把它放进去，然后从底部烧起，最终坍落成灰。

焚烧也能让一张“放手”的纸在展馆里获得另一段生命。原来的文字已经不在，新的作品独自成立。
一张纸可能变成一幅图像，伴着一段短短的音乐。
我希望这种可能让人足够好奇，愿意写下、放手，然后回来看看被丢弃的念头能变成什么。
对我来说，重生意味着感受的转变：从悲伤走向明亮，从愤怒走向平静，从无力走向生机。
[Matt Stone 的 Goodgrowth 案例研究](https://tympanus.net/codrops/2026/08/27/goodgrowth-boot-sequences-spinning-discs-and-the-art-of-the-portfolio/)
塑造了展馆的环形轨道和中央旋转的唱片；我用纸质封套和黑胶，让每件作品都有属于自己的时刻。

其中一些承诺是我可以检验的。
[CLAUDE.md](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/CLAUDE.md)
列出了规则；
[见证检查](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/witness.test.ts)、
[焚烧检查](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/burn.test.ts)
和
[实时检查](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/spec/realtime.test.ts)
守护着来访者之间发生的事。但它是否让人感到释然，需要我自己来判断。
我把桌面端和手机端的画面与纸张和展馆的参考图对照，寻找始终可读的纸页、一直烧到灰烬的火焰，以及让物体各安其位的运动。
我修正过一次戛然而止的焚烧，也修正过一张过早移到封套前面的唱片。
对于展馆，我会判断图像和音乐是否承载了同一个连贯的情绪转折。
[PROCESS.md](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/PROCESS.md)
记录了这些修正。

## 如何使用 Throwaway

### 进入空间

[打开房间](https://comp4020-final-aurorasundev.fly.dev/)。你无需注册就可以开始。
一个 Cookie 会给这个浏览器一个匿名身份。另一个浏览器配置文件或无痕窗口，就是另一位来访者。
想在其他浏览器里找回你的纸，请使用右上角的 **登录**。

### 留下一张纸

选择 **在这里留下点什么**。用 **书写** 写下最多 2,000 个字符，或用 **绘画** 在纸上留下痕迹。
同一张纸上两者都可以用；切换标签不会丢失你的草稿。画具包括笔、橡皮、撤销和清空。

选择留下它的方式：

- **留给自己：** 当你再次遇到这张纸时，你保留销毁它的权利。
- **放手：** 任何打开并见证它的人都可以销毁它。它燃尽时，其内容可以塑造一张公开的展馆唱片。

阅读并勾选 **我明白**，然后选择 **揉皱，扔出去**。你的纸经过检查和保存后，才会进入共享的房间。
一旦扔出，它的文字、图画和方式就固定下来。提交失败时，打开的草稿会保留，供你修改或重试。

### 相遇与见证

点击或轻触一张纸来打开它。你也可以用 Tab 键找到纸张的控件，并用键盘打开。
读完它的文字和图画后，选择 **我看见了** 来见证它。
每位其他读者只会增加一次见证，无论他们回来多少次。
你可以确认自己的纸，但不会增加它的见证次数。用叉号或 Esc 键合上纸页，回到房间。

### 放走一张纸

你可以销毁自己“留给自己”的纸。要销毁一张“放手”的纸，需要先打开它并选择 **我看见了**，即使它是你自己写的。

在阅读纸页中，**放手** 会唤出火炉。把漂浮的纸拖进炉口，或选择 **放进火炉**。
放进去之前，你可以取消。一旦服务器确认，这张纸便从共享的收藏中消失，焚烧随之开始。
其他来访者会看到它在原处燃烧。正在读它的人可以读完。

让纸一直烧成灰烬，然后选择 **回到空间**。灰烬出现三秒后，返回按钮才可以使用。

### 保留一个账户（可选）

选择右上角的 **登录**，然后用用户名和密码 **创建一个账户**。
在你第一次“留给自己”和留下第三张纸之后，也会收到邀请；**以后再说** 会关闭它。
创建账户会保留你已经留下的一切，以及你对它们的权利。
这里不需要邮箱：账户创建后，你会得到一个只显示一次的恢复码，请把它保存在安全的地方。
忘记密码时，在登录窗口选择 **忘记密码？**，输入用户名和恢复码就能设置新密码，之后你会得到一个新的恢复码。

登录后，你的用户名会取代 **登录**。选择它，可以看到你仍留在空间里的纸，分为两组：
**由你保管**，只有你能放走；**已放手**，它们在读者手中。打开其中任何一张都可以重读。
在它们下面，**它们变成了什么** 展示你放手的纸留下的展馆唱片，你可以播放它们。只有你能看到这些。
其他人遇见你的纸和唱片时，依然不知道是谁留下的。
在另一个浏览器上登录，也会把同样的纸和权利带到那里。**退出登录** 会让这个浏览器变回一位新访客。

### 参观展馆，聆听

选择 **展馆**，或[走进展览](https://comp4020-final-aurorasundev.fly.dev/gallery/)。
滚动、滑动或选择入口提示即可进入。用滚轮或拖动来转动收藏，也可以用箭头按钮和键盘方向键。
窄屏会显示纵向的轨道。选择一件作品即可打开它的唱片；**回到展馆** 会回到浏览。
展馆的字标会回到入口，**回到空间** 则回到房间。

在有声音的唱片上选择 **聆听**。它 24 秒的器乐在你的浏览器里演奏；播放、暂停和音量都由你掌控。
声音在你选择聆听时开始，在你离开唱片时停止。只有图像的唱片会说明自己没有声音。
“初次相遇”和“尚未聆听”描述的是这个浏览器记得的活动。

图像会在一张“放手”的纸燃尽、处理完成之后出现。有些放手的纸不会留下唱片。
“留给自己”的纸不会留下展馆唱片。展览呈现这些作品，但不附带指向其来源的链接。

### 分享这个房间

在两个不同的浏览器配置文件中打开 Throwaway，就能以两个人的身份来访。
保存或焚烧一张纸，会在大约一秒内改变另一个打开的房间，无需刷新。
每个房间展示共享收藏中的一部分，纸张的位置各不相同。
保存的纸会在多次来访、重启和重新部署之间一直保留，直到被焚烧或移除。

## 安全检查与举报

纸一旦扔出就是公开的。OpenAI 会在发布前检查提交的文字和图画。
寻常的痛苦、遗憾、愤怒和对伤害的讲述，都属于这里。
威胁、针对性的辱骂、能识别个人身份的私人信息、有害的指导、性剥削和诈骗会被拒绝。
请不要在纸上写入私人信息。

一张“放手”的纸燃尽时，它的文字和图画会从存储的纸中清除。
它们会从内存中被发送给 OpenAI 一次，用来提取创作方向。
这些方向塑造经过检查的图像，以及浏览器里的乐谱。展馆存储的是这些方向和最终的作品。

在打开的条目中使用 **举报这张纸** 或 **举报这张唱片**。
纸张的举报会经过自动或运营者审核；展馆的举报交给运营者处理。
仅仅举报不会让条目下架，它在审核期间仍然可见。因安全原因被移除的纸张文字，会立即从正在进行的阅读中消失。

OpenAI 会收到完成这些检查和创作处理所需的内容。
来访者身份、Cookie、用户名和密码都不会出现在这些请求中。
账户只存储用户名和密码经加盐、加胡椒的 scrypt 哈希，从不存储密码本身，也不存储邮箱。
举报的补充说明保留 30 天。处理和审核的细节见
[审核决策](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/004-configured-safety-review.md)
和[展馆决策](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/005-release-keepsakes.md)。

## 实现参考

- [Paper Crumple 演示](https://github.com/item-develop/paper-crumple-demo)，
  由 nagasawa（ITEM Inc.）制作，提供了折叠动画和纸张物理效果，依 MIT 许可复用。
  [第三方声明](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/THIRD_PARTY_NOTICES.md)
  记录了所做的改动。
- 关于[实时更新](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/001-sse-snapshots.md)、
  [读完一张纸](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/002-active-reader-final-read.md)、
  [火炉中的放置](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/003-furnace-confirmation.md)、
  [唱片音乐](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/006-browser-synthesised-record-music.md)、
  [匿名身份](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/007-people-and-permissions.md)、
  [情绪反转](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/008-rebirth-reversal.md)
  和[可选账户](https://github.com/comp4020-agentic-coding-studio/comp4020-final-aurorasundev/blob/main/docs/adr/009-optional-accounts.md)
  的决策，解释了这些体验是如何实现的。
