# WerewolfParty 技术架构文档

## 一、项目概述

狼人杀局域网联机游戏，支持4-10人游戏，无法官模式，所有玩家参与游戏。

### 核心特性
- 局域网联机（自动发现 + 手动输入IP）
- 无法官模式（游戏流程自动化）
- 角色可配置（狼人、村民、预女猎守）

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
│  │ 房间管理  │  │ 游戏界面  │  │ 聊天系统  │  │ 状态显示  │    │
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
  id: string;                    // 房间ID (6位数字)
  hostId: string;                // 房主玩家ID
  players: Player[];             // 玩家列表
  config: RoomConfig;            // 房间配置
  gameState: GameState | null;   // 游戏状态
  status: 'waiting' | 'playing' | 'finished';
  createdAt: number;
}

interface RoomConfig {
  maxPlayers: number;            // 最大玩家数 (4-10)
  roles: Role[];                 // 启用的角色
  wolfCount: number;             // 狼人数量 (1-2)
  discussTime: number;           // 讨论时间 (秒)
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

interface RoleInfo {
  id: Role;
  name: string;
  camp: 'villager' | 'werewolf';
  description: string;
  skill: string;
  canDisable: boolean;           // 是否可禁用
}
```

### 4.4 游戏状态 (GameState)

```typescript
interface GameState {
  phase: GamePhase;
  day: number;                   // 第几天
  nightActions: NightAction[];   // 夜晚行动记录
  dayActions: DayAction[];       // 白天行动记录
  deadPlayers: DeadPlayer[];     // 死亡玩家
  messages: ChatMessage[];       // 聊天记录
  phaseTimer: number;            // 阶段倒计时
  winner: 'villager' | 'werewolf' | null;
}

enum GamePhase {
  NIGHT_WEREWOLF = 'night_werewolf',
  NIGHT_SEER = 'night_seer',
  NIGHT_WITCH = 'night_witch',
  NIGHT_GUARD = 'night_guard',
  DAY_ANNOUNCE = 'day_announce',
  DAY_DISCUSS = 'day_discuss',
  DAY_VOTE = 'day_vote',
  GAME_OVER = 'game_over'
}
```

## 五、Socket.IO 事件设计

### 5.1 房间事件

```typescript
// 客户端 -> 服务端
interface ClientEvents {
  'room:create': (data: { playerName: string, config: RoomConfig }) => void;
  'room:join': (data: { roomId: string, playerName: string }) => void;
  'room:leave': () => void;
  'room:updateConfig': (data: Partial<RoomConfig>) => void;
  'room:start': () => void;
}

// 服务端 -> 客户端
interface ServerEvents {
  'room:created': (data: { roomId: string }) => void;
  'room:joined': (data: { room: Room }) => void;
  'room:updated': (data: { room: Room }) => void;
  'room:error': (data: { message: string }) => void;
  'room:playerJoined': (data: { player: Player }) => void;
  'room:playerLeft': (data: { playerId: string }) => void;
}
```

### 5.2 游戏事件

```typescript
// 客户端 -> 服务端
interface ClientEvents {
  'game:werewolfKill': (data: { targetId: string }) => void;
  'game:seerCheck': (data: { targetId: string }) => void;
  'game:witchSave': () => void;
  'game:witchPoison': (data: { targetId: string }) => void;
  'game:guardProtect': (data: { targetId: string }) => void;
  'game:vote': (data: { targetId: string }) => void;
  'game:chat': (data: { message: string }) => void;
}

// 服务端 -> 客户端
interface ServerEvents {
  'game:started': (data: { gameState: GameState, myRole: Role }) => void;
  'game:phaseChanged': (data: { phase: GamePhase, timer: number }) => void;
  'game:playerDead': (data: { playerId: string, reason: string }) => void;
  'game:seerResult': (data: { playerId: string, isWerewolf: boolean }) => void;
  'game:voteResult': (data: { votes: Record<string, number>, eliminated: string | null }) => void;
  'game:over': (data: { winner: string, players: Player[] }) => void;
  'game:message': (data: ChatMessage) => void;
}
```

## 六、游戏状态机

```
                    ┌─────────────────┐
                    │   WAITING       │
                    │   (等待开始)     │
                    └────────┬────────┘
                             │ 房主点击开始
                             ▼
                    ┌─────────────────┐
                    │   NIGHT_START   │
                    │   (夜晚开始)     │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │ WEREWOLF    │  │ SEER        │  │ GUARD       │
    │ (狼人行动)   │→│ (预言家查验) │→│ (守卫守护)   │
    └─────────────┘  └─────────────┘  └─────────────┘
              │
              ▼
    ┌─────────────┐
    │ WITCH       │
    │ (女巫行动)   │
    └─────────────┘
              │
              ▼
    ┌─────────────┐
    │ DAY_ANNOUNCE│
    │ (公布死亡)   │
    └─────────────┘
              │
              ▼
    ┌─────────────┐
    │ DAY_DISCUSS │
    │ (自由讨论)   │
    └─────────────┘
              │
              ▼
    ┌─────────────┐
    │ DAY_VOTE    │
    │ (投票淘汰)   │
    └─────────────┘
              │
              ▼
    ┌─────────────┐
    │ 胜负判定     │
    └─────────────┘
         │    │
         │    │ 游戏继续
         │    └──→ 回到 NIGHT_START
         │
         ▼
    ┌─────────────┐
    │ GAME_OVER   │
    │ (游戏结束)   │
    └─────────────┘
```

## 七、项目结构

```
WerewolfParty/
├── CLAUDE.md                    # 项目规范文档
├── package.json                 # 根配置 (monorepo)
├── packages/
│   ├── shared/                  # 共享类型定义
│   │   ├── index.ts             # 类型、枚举、常量
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── client/                  # 前端项目
│   │   ├── src/
│   │   │   ├── components/      # React组件
│   │   │   │   ├── Home.tsx     # 首页
│   │   │   │   ├── Room.tsx     # 房间页
│   │   │   │   └── Game.tsx     # 游戏页
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

## 八、局域网通信方案

### 8.1 房间发现

```typescript
// 服务端 UDP 广播
const BROADCAST_PORT = 41234;
const BROADCAST_INTERVAL = 3000; // 3秒

// 广播内容
interface BroadcastMessage {
  type: 'room_announce';
  roomId: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  port: number; // Socket.IO端口
}
```

### 8.2 客户端发现

```typescript
// 监听UDP广播
// 解析广播消息
// 显示可用房间列表
```

## 九、游戏规则实现

### 9.1 角色技能

| 角色 | 技能 | 实现要点 |
|------|------|----------|
| 狼人 | 击杀 | 每晚必须选择一人，多狼时投票决定 |
| 预言家 | 查验 | 每晚可查验一人，返回是否狼人 |
| 女巫 | 解药/毒药 | 各限1次，不能同一晚使用，不能自救 |
| 猎人 | 开枪 | 死亡时可选择带走一人（被毒不能发动） |
| 守卫 | 守护 | 每晚守护一人，不能连续两晚同一人 |

### 9.2 胜负判定

```typescript
function checkWinner(gameState: GameState): 'villager' | 'werewolf' | null {
  const alivePlayers = getAlivePlayers(gameState);
  const aliveWolves = alivePlayers.filter(p => p.role === 'werewolf');
  const aliveVillagers = alivePlayers.filter(p => p.role !== 'werewolf');

  if (aliveWolves.length === 0) return 'villager';
  if (aliveWolves.length >= aliveVillagers.length) return 'werewolf';
  return null;
}
```

## 十、开发规范

### 10.1 代码风格
- 使用 TypeScript 严格模式
- 使用 ESLint + Prettier 格式化
- 组件使用函数式组件 + Hooks
- 状态管理使用 Zustand

### 10.2 命名规范
- 组件：PascalCase (如 `GameBoard`)
- 函数/变量：camelCase (如 `getPlayerRole`)
- 常量：UPPER_SNAKE_CASE (如 `MAX_PLAYERS`)
- 文件名：camelCase.ts 或 PascalCase.tsx

### 10.3 错误处理
- 所有Socket事件需要错误处理
- 用户操作需要防抖/节流
- 游戏状态需要校验

### 10.4 测试策略
- 单元测试：游戏逻辑、角色技能
- 集成测试：房间流程、游戏流程
- E2E测试：完整游戏流程
