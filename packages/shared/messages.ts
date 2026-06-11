// 服务端局内提示集中维护，便于保持 UI 文案、回归断言和规则边界一致。
// 注意：这些文案可能被所有玩家看到，不能写入未公开身份或夜晚行动来源。
export const ROOM_ERROR_MESSAGES = {
  roomNotFound: '房间不存在',
  gameAlreadyStarted: '游戏已经开始',
  roomFull: '房间已满',
  duplicatedName: '昵称已被使用',
  sessionExpired: '会话已失效',
  roomExpired: '房间已不存在',
  hostOnlyUpdateConfig: '只有房主可以修改配置',
  cannotUpdateConfigAfterStart: '游戏已经开始，无法修改配置',
  cannotReadyAfterStart: '游戏已开始，无法修改准备状态',
  hostOnlyReset: '只有房主可以重新开局',
  resetOnlyAfterFinished: '游戏结束后才能重新开局',
  invalidSeat: '无效的座位号',
  swapAlreadyPending: '你已有座位交换正在处理中',
  noCancelableSwap: '没有可取消的交换请求',
  noPendingSwap: '没有待处理的交换请求'
} as const;

export const ROOM_RESULT_MESSAGES = {
  swapRequestSent: '已发送交换请求，等待对方确认',
  swapCancelledBySelf: '已取消交换请求',
  swapCancelledByPeer: '对方已取消交换请求',
  swapPeerLeft: '对方已离开，交换取消',
  swapSuccess: '交换位置成功',
  swapRejected: '对方拒绝了交换请求'
} as const;

export function playerSwapBusyMessage(playerName: string): string {
  return `${playerName} 正在与其他玩家交换位置`;
}

export const GAME_ERROR_MESSAGES = {
  paused: '游戏已暂停',
  roomNotFound: '未找到房间',
  hostOnlyStart: '只有房主可以开始游戏',
  playerOffline: '有玩家离线，暂时无法开始游戏',
  nonHostPlayersNotReady: '除房主外所有玩家准备后才能开始游戏',
  hostOnlyPause: '只有房主可以暂停游戏',
  pauseOnlyWhenPlaying: '只有游戏进行中可以暂停',
  hostOnlyResume: '只有房主可以恢复游戏',
  wolfFriendlyFireForbidden: '当前规则禁止狼人自刀或刀狼队友',
  wolfTargetRequired: '请先选择目标',
  witchNoSaveTarget: '今晚没有可救目标',
  witchSelfSaveForbidden: '女巫不能自救',
  witchSaveUsed: '解药已使用',
  witchSaveUsedThisGame: '本局解药已使用',
  witchPoisonUsed: '毒药已使用',
  guardCannotRepeatTarget: '不能连续两晚守护同一人',
  notYourTurnToSpeak: '还没轮到你发言',
  selfRevealPhaseForbidden: '当前阶段不能自曝',
  selfRevealFailed: '自曝失败',
  whiteWolfKingExplodePhaseForbidden: '当前阶段不能自曝带走',
  whiteWolfKingExplodeTargetRequired: '请选择一名存活的其他玩家',
  whiteWolfKingExplodeFailed: '带走目标失败'
} as const;

export function roomNotFullMessage(requiredPlayers: number): string {
  return `需要${requiredPlayers}名玩家满员后才能开始`;
}

export const SYSTEM_MESSAGES = {
  peacefulNight: '昨晚是平安夜，没有人死亡'
} as const;

export function wolfSelfRevealMessage(playerNumber: number, playerName: string): string {
  return `${playerNumber}号 ${playerName} 自曝，白天流程中断`;
}

export function whiteWolfKingExplodeMessage(
  playerNumber: number,
  playerName: string,
  targetName: string
): string {
  return `${playerNumber}号 ${playerName} 白狼王自曝，带走 ${targetName}`;
}
