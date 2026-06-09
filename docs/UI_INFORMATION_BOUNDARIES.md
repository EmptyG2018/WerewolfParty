# UI 信息边界与组件拆分规划

本文档用于指导后续游戏 UI、环节过渡、布局、按钮和提示系统重构。目标是在提升狼人杀氛围和操作体验的同时，严格保护重连恢复、信息隔离和服务端权威状态。

## 核心原则

- 客户端 UI 只展示自己被授权接收的数据，不通过阶段跳转、倒计时、提示文案或空状态推断隐藏身份。
- 服务端状态是事实来源；客户端本地状态只用于未提交选择、弹窗开关、筛选条件和动画。
- 公共 UI 只读 `PublicRoom`、`PublicGameState`、公开事件和公开死亡原因。
- 私有 UI 必须由本人身份和私有事件共同授权，例如 `myRole`、`wolfTeam`、`witchInfo`、`skillState`、`seerResult`、`hunterRequired`、`wolfKingRequired`。
- 局中复盘、死亡时间线、阶段提示必须脱敏；终局后才允许结合 `revealedPlayers` 做身份增强展示。
- 重连后必须能从服务端重放状态恢复 UI；不能依赖刷新前保存在组件内的临时状态完成业务判断。

## 当前主要状态来源

### 公共状态

- `room:joined` / `room:updated` / `room:reconnected`
  - 来源：`PublicRoom`
  - 允许展示：玩家座位号、姓名、在线、生死、房主、准备状态、公开房间配置。
  - 禁止展示：其他玩家身份。
- `game:started` 中的 `gameState`
  - 来源：`PublicGameState`
  - 允许展示：阶段、天数、倒计时、暂停状态、公开死亡记录、公开投票历史、公开复盘事件。
  - 禁止展示：`nightActions`、真实死亡原因、完整实时投票、女巫用药消耗内部字段、守卫内部目标、狼队确认票内部字段。
- `game:phaseChanged` / `game:resumed` / `game:paused`
  - 允许展示：当前公开阶段、倒计时、暂停恢复状态。
  - 禁止展示：非行动者隐藏阶段真实名称。
- `game:playerDead`
  - 允许展示：`PublicDeathReason`，例如 `night`、`skill`、`voted`、`self_exposed`、`exploded`。
  - 禁止展示：`killed`、`poisoned`、`shot` 等内部原因。
- `game:voteResult`
  - 允许展示：已结算轮次的完整投票详情。
  - 禁止展示：未结算实时投票明细。
- `game:reviewEvent`
  - 允许展示：已结算、已脱敏复盘事件。
  - 禁止展示：局中使用“刀杀”“毒杀”“开枪”等会暴露身份或行动来源的文案。

### 私有状态

- `myRole`
  - 仅用于本人身份卡、本人可执行技能判断和本人阵营显示。
  - 不能用于推断其他玩家身份。
- `wolfTeam`
  - 仅狼人阵营接收。
  - 允许展示：狼队成员、狼队协商选择、狼队确认状态。
  - 禁止向非狼人展示。
- `wolfSelections` / `wolfVotes`
  - 仅狼队接收。
  - 允许展示：狼队实时选择和确认状态。
  - 禁止出现在公共玩家卡、公共提示和复盘未结算区。
- `seerResult`
  - 仅预言家本人接收。
  - 允许展示：本人本晚查验结果。
  - 禁止进入公共消息、复盘和其他玩家重连状态。
- `witchInfo`
  - 仅女巫本人接收。
  - 允许展示：今晚被袭击玩家、解药可用条件。
  - 禁止向其他玩家展示或通过阶段文案间接暴露。
- `skillState`
  - 仅对应角色本人接收。
  - 女巫：解药/毒药可用状态。
  - 守卫：上晚守护目标。
  - 禁止作为公共状态展示。
- `hunterRequired` / `wolfKingRequired`
  - 仅行动者本人接收。
  - 行动者 UI 可显示技能选择；非行动者只显示安全 `day_resolving`。

### 本地临时状态

- `selectedTarget`
  - 只表示客户端当前选中，不能表示已提交。
  - 阶段变化必须清空；狼人阶段可由私有 `wolfSelections[myId]` 恢复未确认选择。
- `pendingConfirm`
  - 只表示本地二次确认弹窗。
  - 重连、阶段变化、提交后必须清空。
- `transitionPhase`
  - 只用于动画展示。
  - 必须使用安全阶段映射，不应直接暴露隐藏阶段。
- `voteHistoryOpen` / `reviewFilter`
  - 只用于抽屉和筛选 UI。
  - 不参与业务结算。

## UI 模块边界

### 1. `GameShell`

职责：
- 组合页面框架、背景氛围、安全区、弹层挂载点。
- 读取 `room`、`gameState`、`myRole` 判断是否可渲染游戏页。

允许数据：
- `room`
- `gameState`
- `myRole`
- `isNight` 这类由公开阶段派生的安全状态。

禁止：
- 处理角色技能提交。
- 根据私有状态决定公共页面结构。

### 2. `PhaseHeader`

职责：
- 展示天数、公开阶段名、倒计时、暂停/恢复按钮、本人身份摘要。

允许数据：
- `gameState.phase`
- `gameState.day`
- `gameState.phaseTimer`
- `gameState.phaseEndsAt`
- `gameState.paused`
- `myRole`
- `isHost`

注意：
- 对隐藏阶段，非行动者只能显示 `day_resolving` 语义。
- 阶段文案必须走安全映射表。

### 3. `PhaseTransitionOverlay`

职责：
- 阶段切换动画。

允许数据：
- 安全后的公开阶段。
- 行动者本人收到的隐藏阶段可以显示技能转场。

禁止：
- 非行动者看到 `hunter_shoot`、`wolf_king_shoot`。
- 通过“等待猎人/狼王”等文案暴露身份。

### 4. `PlayerSeatGrid`

职责：
- 展示玩家座位、姓名、在线、生死、当前发言、可选目标、本人标记。

允许数据：
- `PublicRoom.players`
- `myId`
- `speaking`
- `deathEvents`，原因必须为 `PublicDeathReason`
- 由当前玩家权限派生出的可选目标状态。

私有增强：
- 狼人本人可看到狼队选择/确认角标。
- 女巫、守卫、预言家只能看到自己行动所需的目标可选/禁用态。

禁止：
- 非狼人看到狼队选择。
- 其他玩家看到真实身份。
- 通过禁用原因暴露某角色是否存在或已死亡。

### 5. `ActionDock`

职责：
- 固定底部操作区。
- 只展示当前玩家当前阶段可执行的操作。

允许数据：
- `myRole`
- `myId`
- `isAlive`
- `gameState.phase`
- `gameState.paused`
- 私有授权状态：`witchInfo`、`skillState`、`wolfSelections`、`wolfVotes`。

按钮规则：
- 危险操作必须二次确认：狼刀确认、女巫毒药、猎人/狼王技能、自曝、自曝带人。
- 常规操作可直接提交：预言家查验、守卫守护。
- 投票建议保留确认；弃票可作为次级按钮。

禁止：
- 未授权玩家看到角色技能按钮。
- 死亡普通玩家看到行动按钮。

### 6. `SpeakingPanel`

职责：
- 展示当前发言/遗言进度。
- 当前发言者显示“发言完毕”。

允许数据：
- `speaking`
- `myId`
- `isAlive`
- `gameState.phase`

注意：
- 遗言只在 `last_words` 显示。
- 技能击杀不触发遗言，UI 不应显示遗言入口。

### 7. `PhaseResultPanel`

职责：
- 展示昨夜结果、投票结果。

允许数据：
- `deathEvents` 中已公开的当日死亡。
- `voteResult` 已结算投票结果。

禁止：
- 夜晚死亡未公开前展示。
- 展示内部死亡原因。

### 8. `ReviewDrawer`

职责：
- 展示局中/终局复盘。
- 按天分组，支持夜晚/投票/技能筛选。

允许数据：
- `gameState.reviewEvents`
- `room.players`
- `revealedPlayers`，仅 `game_over` 后使用。

禁止：
- 局中根据事件推断身份。
- 局中显示“猎人开枪”“女巫毒杀”“狼人刀杀”。

### 9. `PrivateResultModal`

职责：
- 展示预言家查验结果等私有结果。

允许数据：
- `seerResult` 且当前玩家有 `SEER_CHECK` 能力。

禁止：
- 转为系统消息或公共复盘。

### 10. `ConfirmDialog` 与 `ToastLayer`

职责：
- 统一危险确认、普通提示、错误提示。

数据来源：
- 本地临时 `pendingConfirm`
- `game:error`
- `room:error`
- 安全公共系统消息

注意：
- 错误提示不能暴露隐藏身份，例如“猎人阶段不可操作”这类内部原因不应给非行动者。

## 组件拆分建议

当前 `packages/client/src/components/Game.tsx` 承担了状态派生、规则判断、布局、动作提交、弹窗和复盘渲染。后续建议按以下顺序拆分：

1. 新建纯函数层
   - `packages/client/src/game-ui/phaseText.ts`
   - `packages/client/src/game-ui/reviewText.ts`
   - `packages/client/src/game-ui/permissions.ts`
   - 作用：集中安全阶段文案、复盘脱敏文案、可行动/可选目标判断。

2. 新建通用 UI 组件
   - `ConfirmDialog`
   - `ToastLayer`
   - `PhaseTransitionOverlay`
   - `PhaseHeader`

3. 拆主布局组件
   - `GameShell`
   - `PlayerSeatGrid`
   - `PhaseResultPanel`
   - `ReviewDrawer`

4. 拆角色行动组件
   - `WerewolfActionPanel`
   - `SeerActionPanel`
   - `WitchActionPanel`
   - `GuardActionPanel`
   - `HunterActionPanel`
   - `VoteActionPanel`

5. 最后收敛 `Game.tsx`
   - 只保留状态读取、动作分发和组件组合。
   - 业务判断尽量进入 `permissions.ts`，文案进入安全映射文件。

## 重连恢复检查点

每次拆分或重构后必须验证：

- 刷新后仍能回到游戏页。
- 当前阶段、天数、倒计时正确。
- 暂停/恢复状态正确。
- 本人身份正确恢复。
- 狼人重连后能恢复狼队列表、当前选择、确认票。
- 女巫重连后能恢复被刀目标和药品状态。
- 守卫重连后能恢复上晚守护目标。
- 预言家重连后不应看到其他玩家查验信息。
- 猎人/狼王隐藏阶段重连：
  - 行动者看到技能 UI。
  - 非行动者只看到 `day_resolving`。
- 当前投票只恢复本人投票状态，不公开完整实时投票。
- 已结算复盘记录可恢复，且死亡原因脱敏。

## 信息隔离验收清单

- `PublicRoom.players[].role` 始终为 `null`。
- `PublicGameState` 不包含内部字段。
- 局中死亡原因只使用 `PublicDeathReason`。
- 局中复盘不出现“刀杀”“毒杀”“开枪”等暴露来源的描述。
- 女巫 `witchInfo` 只在本人 UI 使用。
- `skillState` 只在女巫/守卫本人 UI 使用。
- 狼队协商状态只在狼队 UI 使用。
- 预言家结果只在本人私有弹层展示。
- 隐藏死亡技能阶段不向非行动者展示真实阶段。
- UI 禁用态和空态文案不暴露角色是否已死亡或是否存在。

## 后续执行顺序

### P0：提示与基础组件统一

- 抽出 `ConfirmDialog`、统一错误提示和普通提示。
- 抽出 `PhaseHeader`。
- 把阶段名、副标题、图标迁移到安全映射文件。
- 验证构建和回归。

### P1：安全转场系统

- 已抽出 `PhaseTransitionOverlay`，转场文案统一来自安全阶段映射。
- 区分公开阶段和行动者私有隐藏阶段。
- 非行动者隐藏阶段统一显示结算等待。
- 验证猎人/狼王隐藏阶段回归。

### P2：布局重构

- 已抽出 `PlayerSeatGrid`、`PhaseResultPanel`、`ReviewDrawer`。
- 保持现有行为不变，只重排布局和样式。
- 验证重连、投票历史、复盘恢复。

### P3：角色行动面板拆分

- 逐个角色拆分，不混在同一个大组件内改。
- 每拆一个角色，验证该角色私有状态和非角色视角。
- 已先抽出 `WerewolfActionPanel`，保持狼队预选择、确认票和确认按钮只在狼人夜晚视角使用。
- 已抽出 `VoteActionPanel`，保持投票/弃票只使用本人当前选择和服务端已同步的本人投票状态。
- 已抽出 `WitchActionPanel`，集中展示女巫私有狼刀目标、药品状态、解药/毒药/跳过操作。
- 已抽出 `GuardActionPanel`，集中展示守护目标、上晚守护和禁止连续守护同一目标的私有 UI。
- 已抽出 `SeerActionPanel`，查验操作独立展示；查验结果仍由私有 `seerResult` 弹层展示。
- 已抽出 `HunterActionPanel`，集中处理猎人/狼王隐藏技能阶段的目标选择和猎人不发动入口。

### P4：终局复盘增强

- 只在 `game_over` 后结合 `revealedPlayers` 增强复盘文案。
- 保持局中复盘脱敏。
- 已将复盘摘要、投票明细、得票统计、死亡标签统一接入终局身份增强格式；局中仍只显示座位号和昵称。

## 不在步骤 1 处理的内容

- 不改实际 UI 视觉。
- 不改 Socket 协议。
- 不改游戏规则。
- 不拆代码文件。
- 不新增客户端状态字段。
