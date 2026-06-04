# WerewolfParty 技术架构文档

## 一、项目概述

狼人杀局域网联机游戏，支持 7-12 人游戏，无法官模式，所有玩家参与游戏。适用于露营、聚会等面对面场景，发言通过口头描述，系统提供轮流发言管理和投票功能。

### 核心特性
- 局域网联机（手动输入 IP 加入）
- 无法官模式（游戏流程自动化）
- 角色可配置（狼人、狼王、白狼王、村民、预女猎守）
- 角色预设（9人/12人标准局）
- 轮流发言机制（按座位生成顺序，随机正/反序，手动确认发言完毕）
- 玩家人数：7-12 人

## 二、技术栈

| 层面 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React 18 + TypeScript | ^18.2.0 |
| 构建工具 | Vite | ^5.0.0 |
| 状态管理 | Zustand | ^4.4.0 |
| UI组件 | Tailwind CSS | ^3.4.0 |
| 后端运行时 | Node.js | ^18.0.0 |
| 后端框架 | Express | ^4.18.0 |
| 实时通信 | Socket.IO | ^4.7.0 |
| 包管理 | npm workspaces (monorepo) | - |

## 三、系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端 (React)                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ 房间管理  │  │ 游戏界面  │  │ 发言管理  │  │ 状态显示  │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
                              │ Socket.IO
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        服务端 (Node.js)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │ 房间管理  │  │ 游戏逻辑  │  │ 角色系统  │  │ 状态机    │    │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘    │
└─────────────────────────────────────────────────────────────┘
```

## 四、数据结构设计

### 4.1 房间 (Room)

```typescript
interface Room {
  id: string;                    // 房间ID (6位字母数字)
  hostId: string;                // 房主玩家ID
  players: Player[];             // 玩家列表
  config: RoomConfig;            // 房间配置
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
}

interface RoomConfig {
  maxPlayers: number;            // 最大玩家数 (7-12)
  roles: Role[];                 // 启用的角色
  wolfCount: number;             // 狼人数量
  voteTime: number;              // 投票时间 (秒)
  roleConfirmTime: number;       // 身份确认时间 (秒)
  hybridRoles: Role[];           // 神民同体角色
}
```

### 4.2 玩家 (Player)

```typescript
interface Player {
  id: string;                    // 稳定玩家ID（当前等于 sessionId）
  sessionId: string;             // 重连会话ID
  name: string;                  // 玩家昵称
  roomId: string;                // 所在房间
  playerNumber: number;          // 稳定玩家编号（1-based）
  seatIndex: number;             // 座位号（0-based）
  role: Role | null;             // 分配的角色
  status: 'alive' | 'dead';     // 存活状态
  online: boolean;               // 是否在线
  isHost: boolean;               // 是否房主
  voteTarget: string | null;     // 投票目标
  skillUsed: SkillUsed;          // 技能使用情况
}

interface SkillUsed {
  witchSave: boolean;            // 女巫解药已用
  witchPoison: boolean;          // 女巫毒药已用
  lastGuardTarget: string | null;// 守卫上一晚守护目标
}
```

### 4.3 角色 (Role)

```typescript
enum Role {
  VILLAGER = 'villager',         // 村民
  WEREWOLF = 'werewolf',         // 狼人
  WOLF_KING = 'wolf_king',       // 狼王
  WHITE_WOLF_KING = 'white_wolf_king', // 白狼王
  SEER = 'seer',                 // 预言家
  WITCH = 'witch',               // 女巫
  HUNTER = 'hunter',             // 猎人
  GUARD = 'guard'                // 守卫
}
```

### 4.4 角色预设 (RolePreset)

```typescript
interface RolePreset {
  id: string;
  name: string;                  // "9人标准局"
  playerCount: number;           // 9 | 12
  roles: Role[];                 // 启用的角色
  wolfCount: number;             // 狼人数量
  hybridRoles: Role[];           // 神民同体角色
}

// 预设配置
ROLE_PRESETS = [
  {
    id: 'preset-9',
    name: '9人标准局',
    playerCount: 9,
    roles: [Role.WEREWOLF, Role.SEER, Role.WITCH, Role.HUNTER],
    wolfCount: 3,
    hybridRoles: []
  },
  {
    id: 'preset-12',
    name: '12人进阶局',
    playerCount: 12,
    roles: [Role.WEREWOLF, Role.WOLF_KING, Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD],
    wolfCount: 3,
    hybridRoles: []
  },
]
```

### 4.5 发言状态 (SpeakingState)

```typescript
interface SpeakingState {
  order: string[];               // 发言顺序（玩家ID列表，按座位生成）
  currentIndex: number;          // 当前发言者索引
  confirmed: string[];           // 已确认发言完毕的玩家ID
}
```

### 4.6 游戏状态 (GameState)

```typescript
interface GameState {
  phase: GamePhase;
  day: number;                   // 第几天
  nightActions: NightAction[];   // 夜晚行动记录
  deadPlayers: DeadPlayer[];     // 死亡玩家
  systemMessages: SystemMessage[];// 系统消息
  phaseTimer: number;            // 阶段倒计时
  phaseEndsAt: number | null;    // 服务端阶段结束时间戳
  paused: boolean;               // 是否暂停
  winner: 'villager' | 'werewolf' | null;
  votes: Record<string, string | null>; // 投票记录，null 表示弃票
  voteHistory: VoteHistoryEntry[];
  speaking: SpeakingState | null;// 发言状态
  wolfKingCanShoot: boolean;     // 狼王当前是否可开枪
  wolfVotes: Record<string, string>; // 狼人确认票
  // ...其他字段
}

enum GamePhase {
  WAITING = 'waiting',
  ROLE_CONFIRM = 'role_confirm',
  NIGHT_WEREWOLF = 'night_werewolf',
  NIGHT_SEER = 'night_seer',
  NIGHT_WITCH = 'night_witch',
  NIGHT_GUARD = 'night_guard',
  DAY_ANNOUNCE = 'day_announce',
  DAY_SPEAKING = 'day_speaking', // 轮流发言
  DAY_VOTE = 'day_vote',
  LAST_WORDS = 'last_words',
  DAY_SELF_REVEAL = 'day_self_reveal',
  HUNTER_SHOOT = 'hunter_shoot',
  WOLF_KING_SHOOT = 'wolf_king_shoot',
  GAME_OVER = 'game_over'
}
```

## 五、Socket.IO 事件设计

### 5.1 房间事件

```typescript
// 客户端 -> 服务端
'room:create'      // { playerName, config }
'room:join'        // { roomId, playerName }
'room:reconnect'   // { sessionId }
'room:leave'       // ()
'room:updateConfig' // { Partial<RoomConfig> }
'room:swapSeat'    // { targetSeat }
'room:acceptSwap'  // ()
'room:rejectSwap'  // ()
'room:start'       // ()
'room:reset'       // ()

// 服务端 -> 客户端
'room:created'     // { roomId }
'room:joined'      // { room, sessionId, playerId }
'room:reconnected' // { room, sessionId, playerId }
'room:reconnectFailed' // { message }
'room:updated'     // { room }
'room:error'       // { message }
'room:playerJoined' // { player }
'room:playerLeft'  // { playerId }
'room:swapRequest' // SeatSwapRequest
'room:swapResult'  // { success, message? }
```

### 5.2 游戏事件

```typescript
// 客户端 -> 服务端
'game:confirmRole'   // ()
'game:pause'         // ()
'game:resume'        // ()
'game:werewolfKill'  // { targetId }
'game:wolfConfirmVote' // ()
'game:wolfSelfReveal' // ()
'game:whiteWolfKingExplode' // { targetId }
'game:seerCheck'     // { targetId }
'game:witchSave'     // ()
'game:witchPoison'   // { targetId }
'game:witchPass'     // ()
'game:guardProtect'  // { targetId }
'game:vote'          // { targetId }
'game:abstainVote'   // ()
'game:speakingDone'  // () — 当前发言者确认发言完毕
'game:hunterShoot'   // { targetId }
'game:hunterPass'    // ()
'game:wolfKingShoot' // { targetId }

// 服务端 -> 客户端
'game:started'        // { gameState, myRole, wolfTeam? }
'game:phaseChanged'   // { phase, timer, endsAt, speaking? }
'game:paused'         // { remainingMs }
'game:resumed'        // { phase, timer, endsAt, speaking? }
'game:speakingUpdate' // { speaking } — 发言进度更新
'game:playerDead'     // { playerId, reason, day }
'game:seerResult'     // { playerId, isWerewolf }
'game:wolfVoteUpdate' // { wolfVotes }
'game:wolfSelectionUpdate' // { selections }
'game:roleConfirmed'  // { playerId }
'game:voteResult'     // { votes, eliminated, abstained, isTie, details }
'game:over'           // { winner, players }
'game:systemMessage'  // { id, content, timestamp }
'game:error'          // { message }
'game:hunterRequired' // { playerId }
'game:wolfKingRequired' // { playerId }
```

## 六、业务核心流程

### 6.1 房间与开局

1. 玩家在首页输入昵称，创建或加入房间。
2. 房主在创建房间前选择预设或自定义配置，房间创建后进入等待大厅。
3. 等待大厅支持座位交换：
   - 点击空座会直接换座。
   - 点击已有玩家座位会向对方发送交换请求，对方同意后互换座位。
4. 房主只能在房间满员且所有玩家在线时开始游戏。当前服务端要求 `room.players.length === room.config.maxPlayers`。
5. 开局时服务端重置上一局状态，构建角色池并洗牌：
   - 普狼数量来自 `wolfCount`。
   - `roles` 中除普狼外的角色各加入 1 张。
   - 剩余座位自动补村民。
6. 发牌后进入 `ROLE_CONFIRM`，所有玩家看到自己的身份。所有人确认或倒计时结束后进入第一夜。

### 6.2 状态机总览

```
WAITING
  │ 房主开局
  ▼
ROLE_CONFIRM
  │ 全员确认或倒计时结束
  ▼
NIGHT_WEREWOLF
  │
  ├─> NIGHT_SEER   （启用且有存活行动者时）
  ├─> NIGHT_GUARD  （启用且有存活行动者时）
  └─> NIGHT_WITCH  （启用且有存活行动者时）
        │
        ▼
夜晚结算
  │
  ├─> WOLF_KING_SHOOT （狼王被夜刀死亡时）
  │       │ 开枪/超时
  │       ▼
  └─> DAY_ANNOUNCE
          │ 天亮公告 5 秒；若猎人被夜刀死亡，则公告后触发 HUNTER_SHOOT
          ▼
      DAY_SPEAKING
          │ 所有存活玩家依次确认发言完毕
          ▼
      DAY_VOTE
          │ 全员投票/弃票或倒计时结束
          ▼
      投票结算
          │
          ├─> LAST_WORDS     （有人被放逐时）
          │       │ 遗言结束后，如放逐者是猎人则触发 HUNTER_SHOOT
          │       ▼
          └─> 胜负判定
                  │
                  ├─> GAME_OVER
                  └─> day + 1，进入下一夜
```

### 6.3 夜晚流程

夜晚阶段顺序由房间角色配置动态生成：

1. `NIGHT_WEREWOLF` 固定存在。
2. 启用预言家查验能力时加入 `NIGHT_SEER`。
3. 启用守卫守护能力时加入 `NIGHT_GUARD`。
4. 启用女巫解药或毒药能力时加入 `NIGHT_WITCH`。
5. 若某个阶段没有对应的存活行动者，服务端自动跳过该阶段。

狼人阶段分为“选择”和“确认”：

1. 存活狼人可选择击杀目标，选择会同步给狼队，但尚未锁定。
2. 狼人点击确认后，该狼人的票锁定。
3. 所有存活狼人确认后立即结算狼刀目标。
4. 若阶段超时且狼队未全员确认，服务端随机选择一名存活非狼人作为狼刀目标。
5. 若非超时结算：
   - 无确认票时为平安夜。
   - 最高票唯一时击杀最高票目标。
   - 最高票平票时在平票目标中随机选择。

夜晚死亡结算顺序：

1. 先取狼人击杀目标。
2. 若守卫守护目标等于狼刀目标，狼刀取消。
3. 若女巫当晚使用解药且仍存在狼刀目标，狼刀取消。
4. 女巫毒药目标独立死亡。
5. 同一玩家同时被刀和被毒时只记录一次死亡。
6. 狼王只有“被狼人夜刀死亡”时进入 `WOLF_KING_SHOOT`；被毒、被投、被技能带走不在当前实现中触发狼王技能。

### 6.4 白天流程

1. 夜晚结算后进入 `DAY_ANNOUNCE`，持续 5 秒。
2. 若昨晚无人死亡，系统发送“平安夜”消息。
3. 若猎人被狼人夜刀死亡，天亮公告结束后进入 `HUNTER_SHOOT`，猎人可开枪或放弃，15 秒超时视为放弃。
4. 猎人结算完毕后进入 `DAY_SPEAKING`。
5. 发言结束后进入 `DAY_VOTE`。
6. 投票结束后进行放逐结算、遗言、特殊技能和胜负判定。
7. 若白天狼人或白狼王自曝，当前白天流程中断，短暂停留 `DAY_SELF_REVEAL` 后直接进入下一夜。

### 6.5 投票流程

1. 只有存活玩家可以投票。
2. 玩家不能投给自己。
3. 玩家可以弃票，客户端通过 `game:abstainVote` 上报。
4. 所有存活玩家完成投票/弃票后立即结算。
5. 倒计时结束时，未投票的存活玩家自动记为弃票。
6. 投票结果会记录到 `voteHistory`，用于客户端展示历史投票。
7. 若最高票平票，则无人出局。
8. 若有玩家被放逐，服务端先发送死亡事件，再进入遗言阶段。

## 七、项目结构

```
WerewolfParty/
├── CLAUDE.md                    # 项目规范文档
├── package.json                 # 根配置 (monorepo)
├── packages/
│   ├── shared/                  # 共享类型定义
│   │   ├── index.ts             # 类型、枚举、常量、预设
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── client/                  # 前端项目
│   │   ├── src/
│   │   │   ├── components/      # React组件
│   │   │   │   ├── Home.tsx     # 首页（创建/加入房间）
│   │   │   │   ├── Room.tsx     # 房间页（等待/配置）
│   │   │   │   └── Game.tsx     # 游戏页（发言/投票）
│   │   │   ├── stores/          # Zustand状态管理
│   │   │   │   └── gameStore.ts
│   │   │   ├── lib/
│   │   │   │   └── socket.ts    # Socket.IO客户端
│   │   │   ├── App.tsx
│   │   │   ├── main.tsx
│   │   │   └── index.css
│   │   ├── public/
│   │   │   ├── vite.svg
│   │   │   └── favicon.svg
│   │   ├── index.html
│   │   ├── package.json
│   │   ├── vite.config.ts
│   │   ├── tailwind.config.js
│   │   ├── postcss.config.js
│   │   └── tsconfig.json
│   │
│   └── server/                  # 后端项目
│       ├── src/
│       │   ├── rooms/           # 房间管理
│       │   │   └── RoomManager.ts
│       │   ├── game/            # 游戏逻辑
│       │   │   └── GameManager.ts
│       │   ├── utils/
│       │   │   └── index.ts
│       │   └── index.ts         # 入口文件
│       ├── package.json
│       └── tsconfig.json
```

## 八、游戏规则实现

### 8.1 身份与阵营规则

角色定义位于 `packages/shared/roles.ts`，每个角色由基础身份组和技能能力组成。

| 角色 | 阵营/身份组 | 当前技能能力 | 关键规则 |
|------|-------------|--------------|----------|
| 村民 | 民 | 无 | 自动补齐未分配座位 |
| 狼人 | 狼 | 狼刀、自曝 | 夜晚参与狼队投票；白天发言/投票阶段可自曝中断流程 |
| 狼王 | 狼 | 狼刀、狼王开枪、自曝 | 被狼人夜刀死亡后可开枪；被毒、被投、被技能带走不触发 |
| 白狼王 | 狼 | 狼刀、白天自曝带人 | 夜晚参与狼刀；白天发言/投票阶段可自曝并带走一名存活其他玩家 |
| 预言家 | 神 | 查验 | 夜晚查验一名存活玩家，结果按基础身份判断是否狼人 |
| 女巫 | 神 | 解药、毒药 | 解药/毒药各限一次；不能自救；毒药不能毒自己 |
| 猎人 | 神 | 猎人开枪 | 被狼人夜刀或白天投票放逐时可开枪；被毒、被技能带走不触发 |
| 守卫 | 神 | 守护 | 夜晚守护一名存活玩家，不能连续两晚守护同一人 |

神民同体规则：

1. 只有非狼人神职可以配置为神民同体。
2. 神民同体只影响胜负判定中的身份组统计，不改变角色技能。
3. 神民同体不改变预言家查验结果，仍按基础身份显示狼人/好人。

### 8.2 角色预设配置

| 预设 | 人数 | 普狼 | 狼王 | 好人角色 | 村民 |
|------|------|------|------|----------|------|
| 9人标准局 | 9 | 3 | 无 | 预言家、女巫、猎人 | 3 |
| 12人进阶局 | 12 | 3 | 1 | 预言家、女巫、猎人、守卫 | 4 |

### 8.3 死亡与死亡技能

死亡原因定义：

| 原因 | 含义 | 后续触发 |
|------|------|----------|
| `killed` | 被狼人夜刀死亡 | 猎人可在天亮公告后开枪；狼王可在天亮前开枪 |
| `poisoned` | 被女巫毒药毒死 | 不触发猎人/狼王开枪 |
| `voted` | 白天投票放逐 | 进入遗言；若放逐者是猎人，遗言后可开枪 |
| `shot` | 被猎人或狼王开枪带走 | 不触发二次猎人/狼王技能 |
| `self_exposed` | 狼人/白狼王自曝出局 | 中断白天流程 |
| `exploded` | 被白狼王自曝带走 | 不触发二次猎人/狼王技能 |

当前代码明确避免技能链式结算：猎人、狼王、白狼王带走的目标只记录死亡，不再触发目标自己的死亡技能。

### 8.4 发言规则

普通白天发言：

1. `DAY_ANNOUNCE` 结束且可能的猎人夜死开枪处理完毕后，进入 `DAY_SPEAKING`。
2. 只有存活玩家参与普通发言。
3. 发言顺序基于座位号生成：
   - 若昨晚有狼人击杀目标，则从被刀者座位之后的存活玩家开始。
   - 若没有被刀者，则从当前存活玩家中座位号最小者开始。
   - 服务端随机决定正序或反序。
4. 每名玩家有 60 秒发言时间。
5. 当前发言者点击「发言完毕」会立即推进到下一位。
6. 超时也会自动推进到下一位。
7. 全部发言完成后进入 `DAY_VOTE`。

### 8.5 遗言规则

遗言阶段使用同一套 `SpeakingState` 数据结构，但 `order` 只包含死亡玩家本人。

1. 当前实现只有“白天投票放逐”的玩家进入 `LAST_WORDS`。
2. 遗言持续 30 秒。
3. 遗言玩家点击「遗言完毕」会立即结束遗言。
4. 遗言结束后：
   - 若被放逐者是猎人，则进入 `HUNTER_SHOOT`，猎人可以开枪或放弃。
   - 否则直接进行胜负判定。
5. 夜晚死亡、女巫毒死、猎人/狼王开枪带走、白狼王带走的玩家，当前实现不会进入遗言阶段。

### 8.6 特殊白天技能

狼人自曝：

1. 只有具备 `WOLF_SELF_REVEAL` 能力且存活的狼人角色可发动。
2. 只能在 `DAY_SPEAKING` 或 `DAY_VOTE` 发动。
3. 发动后本人以 `self_exposed` 死亡。
4. 清空当前发言状态和投票状态。
5. 若未触发胜负，`day + 1` 后进入下一夜。

白狼王自曝带人：

1. 只有具备 `WHITE_WOLF_KING_EXPLODE` 能力且存活的白狼王可发动。
2. 只能在 `DAY_SPEAKING` 或 `DAY_VOTE` 发动。
3. 目标必须是存活的其他玩家。
4. 白狼王本人以 `self_exposed` 死亡，目标以 `exploded` 死亡。
5. 若未触发胜负，`day + 1` 后进入下一夜。
6. 被带走目标不会触发猎人/狼王等二次死亡技能。

### 8.7 胜负判定

当前实现采用屠边规则：

1. 所有狼人出局，好人阵营胜利。
2. 所有神职出局，狼人阵营胜利。
3. 所有民出局，狼人阵营胜利。
4. 神民同体角色会同时计入神职组和民组，因此会影响屠边判定。

## 九、开发规范

### 9.1 代码风格
- 使用 TypeScript 严格模式
- 组件使用函数式组件 + Hooks
- 状态管理使用 Zustand

### 9.2 命名规范
- 组件：PascalCase (如 `GameBoard`)
- 函数/变量：camelCase (如 `getPlayerRole`)
- 常量：UPPER_SNAKE_CASE (如 `MAX_PLAYERS`)
- 文件名：PascalCase.tsx

### 9.3 错误处理
- 所有 Socket 事件需要错误处理
- 游戏状态需要校验
- 用户操作反馈通过 `game:error` 事件推送
