import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { Role, ROLES, ROLE_PRESETS, RoomConfig, DEFAULT_ROOM_CONFIG, MIN_PLAYERS, MAX_PLAYERS } from '@werewolf/shared';

const SPECIAL_ROLES = [Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD];

interface CustomConfig {
  maxPlayers: number;
  wolfCount: number;
  enabledRoles: Set<Role>;
}

export function CreateRoom() {
  const { pendingName, createRoom, setCurrentView, setPendingName, error } = useGameStore();
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [selectedPreset, setSelectedPreset] = useState<string>(ROLE_PRESETS[0].id);

  const [custom, setCustom] = useState<CustomConfig>({
    maxPlayers: 9,
    wolfCount: 3,
    enabledRoles: new Set(SPECIAL_ROLES),
  });

  // --- Validation ---
  const getValidation = () => {
    if (mode === 'preset') return { valid: true, message: '' };
    const specialCount = custom.enabledRoles.size;
    const totalAssigned = custom.wolfCount + specialCount;
    if (totalAssigned >= custom.maxPlayers) {
      return { valid: false, message: '角色总数不能超过总人数，需至少留1个村民位' };
    }
    if (custom.wolfCount < 1) {
      return { valid: false, message: '至少需要1名狼人' };
    }
    const maxWolves = Math.floor((custom.maxPlayers - 1) / 2);
    if (custom.wolfCount > maxWolves) {
      return { valid: false, message: `狼人数量不能超过${maxWolves}（需少于好人数量）` };
    }
    return { valid: true, message: '' };
  };

  const validation = getValidation();

  // --- Build config ---
  const buildConfig = (): RoomConfig => {
    if (mode === 'preset') {
      const preset = ROLE_PRESETS.find(p => p.id === selectedPreset)!;
      return {
        maxPlayers: preset.playerCount,
        roles: preset.roles,
        wolfCount: preset.wolfCount,
        voteTime: DEFAULT_ROOM_CONFIG.voteTime,
      };
    }
    const roles: Role[] = [Role.WEREWOLF, ...custom.enabledRoles];
    return {
      maxPlayers: custom.maxPlayers,
      roles,
      wolfCount: custom.wolfCount,
      voteTime: DEFAULT_ROOM_CONFIG.voteTime,
    };
  };

  const villagerCount = mode === 'preset'
    ? (() => {
        const p = ROLE_PRESETS.find(pr => pr.id === selectedPreset)!;
        return p.playerCount - p.wolfCount - p.roles.filter(r => r !== Role.WEREWOLF).length;
      })()
    : custom.maxPlayers - custom.wolfCount - custom.enabledRoles.size;

  // --- Handlers ---
  const handleBack = () => {
    setPendingName(null);
    setCurrentView('home');
  };

  const handleCreate = () => {
    if (!pendingName || !validation.valid) return;
    createRoom(pendingName, buildConfig());
  };

  const toggleRole = (role: Role) => {
    setCustom(prev => {
      const next = new Set(prev.enabledRoles);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return { ...prev, enabledRoles: next };
    });
  };

  const adjustWolf = (delta: number) => {
    setCustom(prev => ({ ...prev, wolfCount: Math.max(1, prev.wolfCount + delta) }));
  };

  const adjustPlayers = (delta: number) => {
    setCustom(prev => {
      const next = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, prev.maxPlayers + delta));
      return { ...prev, maxPlayers: next };
    });
  };

  const getRoleName = (role: Role) => ROLES[role]?.name || role;

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

      {/* Mode Toggle */}
      <div className="px-5 pt-2 pb-1 relative z-10">
        <div className="glass rounded-2xl p-1 flex">
          <button
            onClick={() => setMode('preset')}
            className={`flex-1 py-2.5 rounded-xl font-display text-sm tracking-wide transition-all ${
              mode === 'preset'
                ? 'bg-blood/20 text-blood-400'
                : 'text-moon-dim hover:text-moon'
            }`}
          >
            快速预设
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`flex-1 py-2.5 rounded-xl font-display text-sm tracking-wide transition-all ${
              mode === 'custom'
                ? 'bg-blood/20 text-blood-400'
                : 'text-moon-dim hover:text-moon'
            }`}
          >
            自定义
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-5 py-3 space-y-4 overflow-y-auto relative z-10">

        {/* ---- Preset Mode ---- */}
        {mode === 'preset' && (
          <>
            <div className="animate-slide-up">
              <p className="text-xs text-moon-dim tracking-wider uppercase mb-3">选择预设</p>
              <div className="grid grid-cols-3 gap-2.5">
                {ROLE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    onClick={() => setSelectedPreset(preset.id)}
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

            {/* Preset detail */}
            {(() => {
              const preset = ROLE_PRESETS.find(p => p.id === selectedPreset)!;
              return (
                <div className="glass rounded-2xl p-4 animate-slide-up" style={{ animationDelay: '0.1s' }}>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div className="bg-forest-50/50 rounded-xl p-3 text-center">
                      <div className="text-moon-mist text-[10px] tracking-wider mb-1">狼人</div>
                      <div className="font-display text-xl text-blood-400">{preset.wolfCount}</div>
                    </div>
                    <div className="bg-forest-50/50 rounded-xl p-3 text-center">
                      <div className="text-moon-mist text-[10px] tracking-wider mb-1">村民</div>
                      <div className="font-display text-xl text-heal-400">
                        {preset.playerCount - preset.wolfCount - preset.roles.filter(r => r !== Role.WEREWOLF).length}
                      </div>
                    </div>
                  </div>
                  <div className="text-xs text-moon-dim mb-2">特殊角色</div>
                  <div className="flex flex-wrap gap-1.5">
                    {preset.roles.filter(r => r !== Role.WEREWOLF).map(role => (
                      <span key={role} className="text-xs px-2.5 py-1 rounded-lg bg-white/[0.05] text-moon-dim">
                        {getRoleName(role)}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* ---- Custom Mode ---- */}
        {mode === 'custom' && (
          <>
            {/* Player count */}
            <div className="animate-slide-up">
              <p className="text-xs text-moon-dim tracking-wider uppercase mb-3">总人数</p>
              <div className="glass rounded-2xl p-4 flex items-center justify-between">
                <button
                  onClick={() => adjustPlayers(-1)}
                  disabled={custom.maxPlayers <= MIN_PLAYERS}
                  className="w-10 h-10 rounded-xl bg-forest-50/50 flex items-center justify-center text-moon-dim hover:text-moon disabled:opacity-30 transition-colors text-xl"
                >
                  −
                </button>
                <div className="text-center">
                  <div className="font-display text-3xl text-moon">{custom.maxPlayers}</div>
                  <div className="text-[10px] text-moon-mist">人</div>
                </div>
                <button
                  onClick={() => adjustPlayers(1)}
                  disabled={custom.maxPlayers >= MAX_PLAYERS}
                  className="w-10 h-10 rounded-xl bg-forest-50/50 flex items-center justify-center text-moon-dim hover:text-moon disabled:opacity-30 transition-colors text-xl"
                >
                  +
                </button>
              </div>
            </div>

            {/* Wolf count */}
            <div className="animate-slide-up" style={{ animationDelay: '0.05s' }}>
              <p className="text-xs text-moon-dim tracking-wider uppercase mb-3">狼人数量</p>
              <div className="glass rounded-2xl p-4 flex items-center justify-between">
                <button
                  onClick={() => adjustWolf(-1)}
                  disabled={custom.wolfCount <= 1}
                  className="w-10 h-10 rounded-xl bg-forest-50/50 flex items-center justify-center text-moon-dim hover:text-moon disabled:opacity-30 transition-colors text-xl"
                >
                  −
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-2xl">🐺</span>
                  <div className="font-display text-3xl text-blood-400">{custom.wolfCount}</div>
                </div>
                <button
                  onClick={() => adjustWolf(1)}
                  disabled={custom.wolfCount >= Math.floor((custom.maxPlayers - 1) / 2)}
                  className="w-10 h-10 rounded-xl bg-forest-50/50 flex items-center justify-center text-moon-dim hover:text-moon disabled:opacity-30 transition-colors text-xl"
                >
                  +
                </button>
              </div>
            </div>

            {/* Special roles */}
            <div className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <p className="text-xs text-moon-dim tracking-wider uppercase mb-3">特殊角色</p>
              <div className="grid grid-cols-2 gap-2.5">
                {SPECIAL_ROLES.map(role => {
                  const enabled = custom.enabledRoles.has(role);
                  return (
                    <button
                      key={role}
                      onClick={() => toggleRole(role)}
                      className={`flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 ${
                        enabled
                          ? 'bg-heal/10 border border-heal/30 ring-1 ring-heal/10'
                          : 'glass hover:bg-white/[0.06]'
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${
                        enabled ? 'bg-heal/20' : 'bg-forest-50/50'
                      }`}>
                        {getRoleEmoji(role)}
                      </div>
                      <div className="text-left">
                        <div className={`text-sm font-body ${enabled ? 'text-heal-400' : 'text-moon-dim'}`}>
                          {getRoleName(role)}
                        </div>
                        <div className="text-[10px] text-moon-mist">{ROLES[role].skill}</div>
                      </div>
                      <div className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        enabled
                          ? 'border-heal bg-heal text-forest'
                          : 'border-white/20'
                      }`}>
                        {enabled && (
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Villager auto-fill */}
            <div className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
              <div className="glass rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-forest-50/50 flex items-center justify-center text-lg">👤</div>
                    <div>
                      <div className="text-sm text-moon">村民</div>
                      <div className="text-[10px] text-moon-mist">自动填充</div>
                    </div>
                  </div>
                  <div className={`font-display text-2xl ${villagerCount < 0 ? 'text-blood-400' : 'text-heal-400'}`}>
                    {villagerCount}
                  </div>
                </div>
              </div>
            </div>

            {/* Validation warning */}
            {!validation.valid && (
              <div className="animate-slide-up px-4 py-3 rounded-xl bg-blood/10 border border-blood/20 text-blood-400 text-sm text-center">
                {validation.message}
              </div>
            )}
          </>
        )}
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
          disabled={!pendingName || !validation.valid}
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

function getRoleEmoji(role: Role): string {
  const emojis: Record<Role, string> = {
    [Role.VILLAGER]: '👤',
    [Role.WEREWOLF]: '🐺',
    [Role.SEER]: '🔮',
    [Role.WITCH]: '🧪',
    [Role.HUNTER]: '🔫',
    [Role.GUARD]: '🛡️',
  };
  return emojis[role] || '❓';
}
