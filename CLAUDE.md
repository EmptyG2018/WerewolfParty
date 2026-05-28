# WerewolfParty 技术架构文档

## 一、项目概述

狼人杀局域网联机游戏，支持 7-12 人游戏，无法官模式，所有玩家参与游戏。适用于露营、聚会等面对面场景，发言通过口头描述，系统提供轮流发言管理和投票功能。

### 核心特性
- 局域网联机（手动输入 IP 加入）
- 无法官模式（游戏流程自动化）
- 角色可配置（狼人、村民、预女猎守）
- 角色预设（9人/12人标准局）
- 轮流发言机制（随机顺序，手动确认发言完毕）
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
}
```

### 4.2 玩家 (Player)

```typescript
interface Player {
  id: string;                    // Socket ID
  name: string;                  // 玩家昵称
  roomId: string;                // 所在房间
  role: Role | null;             // 分配的角色
  status: 'alive' | 'dead';     // 存活状态
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
}

// 预设配置
ROLE_PRESETS = [
  { id: 'preset-9',  name: '9人标准局',  playerCount: 9,  wolfCount: 3 },
  { id: 'preset-12', name: '12人进阶局', playerCount: 12, wolfCount: 4 },
]
```

### 4.5 发言状态 (SpeakingState)

```typescript
interface SpeakingState {
  order: string[];               // 发言顺序（玩家ID列表，随机打乱）
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
  winner: 'villager' | 'werewolf' | null;
  votes: Record<string, string>; // 投票记录
  speaking: SpeakingState | null;// 发言状态
  // ...其他字段
}

enum GamePhase {
  WAITING = 'waiting',
  NIGHT_WEREWOLF = 'night_werewolf',
  NIGHT_SEER = 'night_seer',
  NIGHT_WITCH = 'night_witch',
  NIGHT_GUARD = 'night_guard',
  DAY_ANNOUNCE = 'day_announce',
  DAY_SPEAKING = 'day_speaking', // 轮流发言（替代原 DAY_DISCUSS）
  DAY_VOTE = 'day_vote',
  HUNTER_SHOOT = 'hunter_shoot',
  GAME_OVER = 'game_over'
}
```

## 五、Socket.IO 事件设计

### 5.1 房间事件

```typescript
// 客户端 -> 服务端
'room:create'      // { playerName, config }
'room:join'        // { roomId, playerName }
'room:leave'       // ()
'room:updateConfig' // { Partial<RoomConfig> }
'room:start'       // ()

// 服务端 -> 客户端
'room:created'     // { roomId }
'room:joined'      // { room }
'room:updated'     // { room }
'room:error'       // { message }
'room:playerJoined' // { player }
'room:playerLeft'  // { playerId }
```

### 5.2 游戏事件

```typescript
// 客户端 -> 服务端
'game:werewolfKill'  // { targetId }
'game:seerCheck'     // { targetId }
'game:witchSave'     // ()
'game:witchPoison'   // { targetId }
'game:guardProtect'  // { targetId }
'game:vote'          // { targetId }
'game:speakingDone'  // () — 当前发言者确认发言完毕
'game:hunterShoot'   // { targetId }

// 服务端 -> 客户端
'game:started'        // { gameState, myRole }
'game:phaseChanged'   // { phase, timer, speaking? }
'game:speakingUpdate' // { speaking } — 发言进度更新
'game:playerDead'     // { playerId, reason }
'game:seerResult'     // { playerId, isWerewolf }
'game:voteResult'     // { votes, eliminated }
'game:over'           // { winner, players }
'game:systemMessage'  // { id, content, timestamp }
'game:error'          // { message }
'game:hunterRequired' // { playerId }
```

## 六、游戏状态机

```
                    ┌─────────────────┐
                    │   WAITING       │
                    │   (等待开始)     │
                    └────────┬────────┘
                             │ 房主点击开始 (≥7人)
                             ▼
                    ┌─────────────────┐
                    │  NIGHT_WEREWOLF │
                    │  (狼人选择击杀)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │ NIGHT_SEER  │  │ NIGHT_GUARD │  │ NIGHT_WITCH │
    │ (预言家查验) │  │ (守卫守护)   │  │ (女巫行动)   │
    └─────────────┘  └─────────────┘  └─────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  DAY_ANNOUNCE   │
                    │  (公布死亡信息)  │
                    └────────┬────────┘
                             │ 5秒后
                             ▼
                    ┌─────────────────┐
                    │  DAY_SPEAKING   │
                    │  (轮流发言)      │
                    │  随机顺序        │
                    │  当前发言者确认   │
                    │  「发言完毕」     │
                    └────────┬────────┘
                             │ 全部发言完毕
                             ▼
                    ┌─────────────────┐
                    │    DAY_VOTE     │
                    │   (投票淘汰)     │
                    └────────┬────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │    胜负判定      │
                    └────────┬────────┘
                       │           │
                  游戏结束      继续游戏
                       │           │
                       ▼           ▼
                ┌──────────┐  回到夜晚
                │ GAME_OVER │
                │ (游戏结束) │
                └──────────┘
```

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

### 8.1 角色技能

| 角色 | 阵营 | 技能 | 实现要点 |
|------|------|------|----------|
| 狼人 | 狼人 | 击杀 | 每晚必须选择一人，多狼共同决定 |
| 村民 | 好人 | 无 | 普通村民 |
| 预言家 | 好人 | 查验 | 每晚可查验一人，返回是否狼人 |
| 女巫 | 好人 | 解药/毒药 | 各限1次，不能同一晚使用，不能自救 |
| 猎人 | 好人 | 开枪 | 死亡时可选择带走一人（被毒不能发动） |
| 守卫 | 好人 | 守护 | 每晚守护一人，不能连续两晚同一人 |

### 8.2 角色预设配置

| 预设 | 人数 | 狼人 | 特殊角色 | 村民 |
|------|------|------|----------|------|
| 9人标准局 | 9 | 3 | 预言家、女巫、猎人、守卫 | 1 |
| 12人进阶局 | 12 | 4 | 预言家、女巫、猎人、守卫 | 4 |

### 8.3 轮流发言机制

1. 天亮后公布死亡信息（5秒）
2. 系统随机打乱存活玩家顺序
3. 按顺序依次发言（口头描述）
4. 当前发言者点击「发言完毕」后自动轮到下一位
5. 所有人发言完毕后进入投票阶段

### 8.4 胜负判定

- 好人阵营胜利：所有狼人被淘汰
- 狼人阵营胜利：存活狼人 ≥ 存活好人

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

## 十、需求变更记录

> 以「【需求】」开头的输入会自动同步到此章节。

### [2026-05-28] 补充选择配置角色功能
- **类型**: 新增
- **内容**: 房主可以选择并应用角色预设配置（9人/12人），支持自定义调整角色组合
- **影响范围**: Room.tsx（UI交互）、gameStore.ts（updateConfig action）、RoomManager.ts（服务端配置更新）

### [2026-05-28] 独立配置页面与创建流程优化
- **类型**: 变更
- **内容**: 
  1. 新增独立的角色配置页面，房主在创建房间前完成角色组合配置
  2. 优化创建流程：房主必须先配置角色，确认后再创建房间
- **影响范围**: 新增 CreateRoom.tsx、Home.tsx（导航变更）、Room.tsx（移除配置面板）、gameStore.ts（新增 create view）、App.tsx（路由）

### [2026-05-28] 自定义角色组合与规则校验
- **类型**: 变更
- **内容**:
  1. 支持房主自由组合角色（狼人数量、特殊角色开关）
  2. 角色组合需符合游戏规则：特殊角色（预言家/女巫/猎人/守卫）最多各1个，狼人数量可调，村民自动填充剩余位置
- **影响范围**: CreateRoom.tsx（自定义配置 UI 与校验逻辑）、shared/index.ts（校验规则常量）

### [2026-05-28] 移除15人局预设
- **类型**: 移除
- **内容**: 移除15人豪华局预设，游戏人数上限调整为12人
- **影响范围**: shared/index.ts（ROLE_PRESETS、MAX_PLAYERS）、CreateRoom.tsx（预设列表）
