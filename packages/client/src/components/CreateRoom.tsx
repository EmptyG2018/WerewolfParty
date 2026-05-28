import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { Role, ROLES, ROLE_PRESETS, RolePreset, RoomConfig, DEFAULT_ROOM_CONFIG } from '@werewolf/shared';

export function CreateRoom() {
  const { pendingName, createRoom, setCurrentView, setPendingName, error } = useGameStore();
  const [selectedPreset, setSelectedPreset] = useState<string>(ROLE_PRESETS[0].id);
  const [config, setConfig] = useState<RoomConfig>({
    maxPlayers: ROLE_PRESETS[0].playerCount,
    roles: ROLE_PRESETS[0].roles,
    wolfCount: ROLE_PRESETS[0].wolfCount,
    voteTime: DEFAULT_ROOM_CONFIG.voteTime,
  });

  const handleSelectPreset = (preset: RolePreset) => {
    setSelectedPreset(preset.id);
    setConfig({
      maxPlayers: preset.playerCount,
      roles: preset.roles,
      wolfCount: preset.wolfCount,
      voteTime: config.voteTime,
    });
  };

  const handleBack = () => {
    setPendingName(null);
    setCurrentView('home');
  };

  const handleCreate = () => {
    if (!pendingName) return;
    createRoom(pendingName, config);
  };

  const getRoleName = (role: Role) => ROLES[role]?.name || role;

  const currentPreset = ROLE_PRESETS.find(p => p.id === selectedPreset);
  const villagerCount = currentPreset
    ? currentPreset.playerCount - currentPreset.wolfCount - currentPreset.roles.filter(r => r !== Role.WEREWOLF).length
    : 0;

  return (
    <div className="flex flex-col min-h-dvh relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-gradient-to-b from-blood/5 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="safe-top px-5 pt-4 pb-2 flex items-center justify-between relative z-10">
        <button
          onClick={handleBack}
          className="flex items-center gap-1.5 text-moon-dim hover:text-moon transition-colors text-sm"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>
        <h2 className="font-display text-lg text-moon/80">配置房间</h2>
        <div className="w-16" />
      </header>

      {/* Content */}
      <div className="flex-1 px-5 py-4 space-y-5 overflow-y-auto relative z-10">
        {/* Preset Selection */}
        <div className="animate-slide-up">
          <p className="text-xs text-moon-dim tracking-wider uppercase mb-3">选择预设</p>
          <div className="grid grid-cols-3 gap-2.5">
            {ROLE_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset)}
                className={`relative p-4 rounded-2xl text-center transition-all duration-200 ${
                  selectedPreset === preset.id
                    ? 'bg-blood/15 border border-blood/30 ring-1 ring-blood/20'
                    : 'glass hover:bg-white/[0.06]'
                }`}
              >
                <div className="font-display text-2xl text-moon">{preset.playerCount}</div>
                <div className="text-[10px] text-moon-mist mt-1 tracking-wider">人局</div>
                {selectedPreset === preset.id && (
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-blood animate-breathe" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Config Detail */}
        <div className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
          <p className="text-xs text-moon-dim tracking-wider uppercase mb-3">配置详情</p>
          <div className="glass rounded-2xl p-5 space-y-4">
            {/* Wolf count */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blood/15 flex items-center justify-center text-lg">🐺</div>
                <div>
                  <div className="text-sm text-moon">狼人</div>
                  <div className="text-[10px] text-moon-mist">狼人阵营</div>
                </div>
              </div>
              <div className="font-display text-2xl text-blood-400">{config.wolfCount}</div>
            </div>

            <div className="h-px bg-white/[0.04]" />

            {/* Special roles */}
            <div>
              <div className="text-xs text-moon-dim mb-2">特殊角色</div>
              <div className="flex flex-wrap gap-2">
                {config.roles.filter(r => r !== Role.WEREWOLF).map(role => (
                  <div
                    key={role}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-forest-50/50 border border-white/[0.04]"
                  >
                    <span className="text-sm">{getRoleName(role)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="h-px bg-white/[0.04]" />

            {/* Villager count */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-heal/15 flex items-center justify-center text-lg">👤</div>
                <div>
                  <div className="text-sm text-moon">村民</div>
                  <div className="text-[10px] text-moon-mist">好人阵营</div>
                </div>
              </div>
              <div className="font-display text-2xl text-heal-400">{villagerCount}</div>
            </div>
          </div>
        </div>

        {/* Summary */}
        <div className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
          <div className="glass rounded-2xl p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-forest-50/50 rounded-xl p-3 text-center">
                <div className="text-moon-mist text-[10px] tracking-wider mb-1">总人数</div>
                <div className="font-display text-xl text-moon">{config.maxPlayers}</div>
              </div>
              <div className="bg-forest-50/50 rounded-xl p-3 text-center">
                <div className="text-moon-mist text-[10px] tracking-wider mb-1">投票时间</div>
                <div className="font-display text-xl text-moon">{config.voteTime}s</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-5 mb-2 px-4 py-3 rounded-xl bg-blood/10 border border-blood/20 text-blood-400 text-sm text-center animate-slide-up">
          {error}
        </div>
      )}

      {/* Bottom Action */}
      <div className="px-5 pb-safe pt-2 pb-4 relative z-10">
        <button
          onClick={handleCreate}
          disabled={!pendingName}
          className="group relative w-full py-4 rounded-2xl font-display text-lg tracking-wide overflow-hidden transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-blood-700 via-blood to-blood-700 group-hover:from-blood-600 group-hover:via-blood-500 group-hover:to-blood-600 transition-all" />
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-[radial-gradient(circle_at_50%_50%,rgba(255,255,255,0.1),transparent_70%)]" />
          <span className="relative z-10 text-white">创建房间</span>
        </button>
      </div>
    </div>
  );
}
