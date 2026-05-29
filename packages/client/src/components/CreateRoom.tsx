import { useState } from 'react';
import { useGameStore } from '../stores/gameStore';
import { Role, ROLES, ROLE_PRESETS, RoomConfig, DEFAULT_ROOM_CONFIG, MIN_PLAYERS, MAX_PLAYERS, getCampCounts as calcCampCounts } from '@werewolf/shared';

const GOD_ROLES = [Role.SEER, Role.WITCH, Role.HUNTER, Role.GUARD];
const WOLF_EXTRAS = [Role.WOLF_KING];
const HYBRIDABLE_ROLES = [Role.HUNTER, Role.GUARD];

interface CustomConfig {
  maxPlayers: number;
  wolfCount: number;
  enabledExtras: Set<Role>;   // 狼王 + 神职
  hybridRoles: Set<Role>;
}

function toRoomConfig(custom: CustomConfig): RoomConfig {
  const roles: Role[] = [Role.WEREWOLF, ...custom.enabledExtras];
  return { maxPlayers: custom.maxPlayers, roles, wolfCount: custom.wolfCount, voteTime: DEFAULT_ROOM_CONFIG.voteTime, hybridRoles: [...custom.hybridRoles] };
}

export function CreateRoom() {
  const { pendingName, createRoom, setCurrentView, setPendingName, error } = useGameStore();
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const [selectedPreset, setSelectedPreset] = useState<string>(ROLE_PRESETS[0].id);

  const [custom, setCustom] = useState<CustomConfig>({
    maxPlayers: 9,
    wolfCount: 3,
    enabledExtras: new Set(GOD_ROLES),
    hybridRoles: new Set<Role>(),
  });

  // --- Derived ---
  const currentConfig = mode === 'preset'
    ? (() => { const p = ROLE_PRESETS.find(pr => pr.id === selectedPreset)!; return { maxPlayers: p.playerCount, roles: p.roles, wolfCount: p.wolfCount, voteTime: DEFAULT_ROOM_CONFIG.voteTime, hybridRoles: p.hybridRoles }; })()
    : toRoomConfig(custom);
  const currentCounts = calcCampCounts(currentConfig);

  // --- Validation ---
  const getValidation = () => {
    if (mode === 'preset') return { valid: true, message: '' };
    if (custom.wolfCount < 1) return { valid: false, message: '至少需要1名狼人' };
    const maxWolves = Math.floor((custom.maxPlayers - 1) / 2);
    if (currentCounts.wolves > maxWolves) return { valid: false, message: `狼人总数不能超过${maxWolves}` };
    if (currentCounts.villagers < 1) return { valid: false, message: '至少需要1名平民' };
    return { valid: true, message: '' };
  };
  const validation = getValidation();

  // --- Build config ---
  const buildConfig = (): RoomConfig => currentConfig;

  // --- Handlers ---
  const handleBack = () => { setPendingName(null); setCurrentView('home'); };
  const handleCreate = () => { if (!pendingName || !validation.valid) return; createRoom(pendingName, buildConfig()); };

  const toggleExtra = (role: Role) => {
    setCustom(prev => {
      const next = new Set(prev.enabledExtras);
      const nextHybrid = new Set(prev.hybridRoles);
      if (next.has(role)) { next.delete(role); nextHybrid.delete(role); }
      else next.add(role);
      return { ...prev, enabledExtras: next, hybridRoles: nextHybrid };
    });
  };

  const toggleHybrid = (role: Role) => {
    setCustom(prev => {
      const next = new Set(prev.hybridRoles);
      if (next.has(role)) next.delete(role); else next.add(role);
      return { ...prev, hybridRoles: next };
    });
  };

  const adjustWolf = (d: number) => setCustom(prev => ({ ...prev, wolfCount: Math.max(1, prev.wolfCount + d) }));
  const adjustPlayers = (d: number) => setCustom(prev => ({ ...prev, maxPlayers: Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, prev.maxPlayers + d)) }));

  return (
    <div className="flex flex-col min-h-dvh relative">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-gradient-to-b from-blood/5 to-transparent rounded-full blur-3xl pointer-events-none" />

      {/* Header */}
      <header className="safe-top px-5 pt-4 pb-2 flex items-center justify-between relative z-10">
        <button onClick={handleBack} className="flex items-center gap-1.5 text-moon-dim hover:text-moon transition-colors text-sm">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          返回
        </button>
        <h2 className="font-display text-lg text-moon/80">配置房间</h2>
        <div className="w-16" />
      </header>

      {/* Mode Toggle */}
      <div className="px-5 pt-2 pb-1 relative z-10">
        <div className="glass rounded-2xl p-1 flex">
          {(['preset', 'custom'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`flex-1 py-2.5 rounded-xl font-display text-sm tracking-wide transition-all ${mode === m ? 'bg-blood/20 text-blood-400' : 'text-moon-dim hover:text-moon'}`}>
              {m === 'preset' ? '快速预设' : '自定义'}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 px-5 py-3 space-y-4 overflow-y-auto relative z-10">

        {/* ===== Preset Mode ===== */}
        {mode === 'preset' && (
          <>
            {/* Preset selector */}
            <div className="animate-slide-up">
              <div className="grid grid-cols-2 gap-2.5">
                {ROLE_PRESETS.map(preset => (
                  <button key={preset.id} onClick={() => setSelectedPreset(preset.id)}
                    className={`relative p-4 rounded-2xl text-left transition-all duration-200 ${
                      selectedPreset === preset.id ? 'bg-blood/15 border border-blood/30 ring-1 ring-blood/20' : 'glass hover:bg-white/[0.06]'
                    }`}>
                    <div className="font-display text-xl text-moon">{preset.name}</div>
                    <div className="text-[10px] text-moon-mist mt-1">{preset.playerCount}人 · {preset.wolfCount + (preset.roles.includes(Role.WOLF_KING) ? 1 : 0)}狼</div>
                    {selectedPreset === preset.id && <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-blood animate-breathe" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Preset detail: 3 camps */}
            {(() => {
              const p = ROLE_PRESETS.find(pr => pr.id === selectedPreset)!;
              const godRoles = p.roles.filter(r => GOD_ROLES.includes(r));
              return (
                <div className="glass rounded-2xl p-5 animate-slide-up space-y-4" style={{ animationDelay: '0.1s' }}>
                  {/* 狼人阵营 */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">🐺</span>
                      <span className="text-xs text-blood-400 tracking-wider uppercase">狼人阵营</span>
                      <span className="ml-auto font-display text-lg text-blood-400">{currentCounts.wolves}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: p.wolfCount }).map((_, i) => (
                        <span key={`w${i}`} className="text-xs px-2.5 py-1 rounded-lg bg-blood/10 text-blood-400">狼人</span>
                      ))}
                      {p.roles.includes(Role.WOLF_KING) && (
                        <span className="text-xs px-2.5 py-1 rounded-lg bg-blood/10 text-blood-400">👑 狼王</span>
                      )}
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.04]" />

                  {/* 神职阵营 */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">🔮</span>
                      <span className="text-xs text-poison tracking-wider uppercase">神职阵营</span>
                      <span className="ml-auto font-display text-lg text-poison">{currentCounts.gods}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {godRoles.map(role => (
                        <span key={role} className="text-xs px-2.5 py-1 rounded-lg bg-poison/10 text-poison">
                          {getRoleEmoji(role)} {ROLES[role]?.name || role}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="h-px bg-white/[0.04]" />

                  {/* 平民阵营 */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm">👤</span>
                      <span className="text-xs text-heal tracking-wider uppercase">平民阵营</span>
                      <span className="ml-auto font-display text-lg text-heal">{currentCounts.villagers}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Array.from({ length: currentCounts.villagers }).map((_, i) => (
                        <span key={`v${i}`} className="text-xs px-2.5 py-1 rounded-lg bg-heal/10 text-heal">村民</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}
          </>
        )}

        {/* ===== Custom Mode ===== */}
        {mode === 'custom' && (
          <>
            {/* Player count */}
            <div className="animate-slide-up">
              <p className="text-xs text-moon-dim tracking-wider uppercase mb-3">总人数</p>
              <div className="glass rounded-2xl p-4 flex items-center justify-between">
                <button onClick={() => adjustPlayers(-1)} disabled={custom.maxPlayers <= MIN_PLAYERS}
                  className="w-10 h-10 rounded-xl bg-forest-50/50 flex items-center justify-center text-moon-dim hover:text-moon disabled:opacity-30 transition-colors text-xl">−</button>
                <div className="text-center">
                  <div className="font-display text-3xl text-moon">{custom.maxPlayers}</div>
                  <div className="text-[10px] text-moon-mist">人</div>
                </div>
                <button onClick={() => adjustPlayers(1)} disabled={custom.maxPlayers >= MAX_PLAYERS}
                  className="w-10 h-10 rounded-xl bg-forest-50/50 flex items-center justify-center text-moon-dim hover:text-moon disabled:opacity-30 transition-colors text-xl">+</button>
              </div>
            </div>

            {/* 狼人阵营 */}
            <div className="animate-slide-up" style={{ animationDelay: '0.05s' }}>
              <p className="text-xs text-blood-400 tracking-wider uppercase mb-3 flex items-center gap-2">
                <span>🐺</span> 狼人阵营
                <span className="ml-auto font-display text-base text-blood-400">{currentCounts.wolves}</span>
              </p>
              <div className="space-y-2.5">
                {/* Wolf count */}
                <div className="glass rounded-2xl p-4 flex items-center justify-between">
                  <span className="text-sm text-moon">普狼</span>
                  <div className="flex items-center gap-3">
                    <button onClick={() => adjustWolf(-1)} disabled={custom.wolfCount <= 1}
                      className="w-8 h-8 rounded-lg bg-forest-50/50 flex items-center justify-center text-moon-dim hover:text-moon disabled:opacity-30 transition-colors">−</button>
                    <span className="font-display text-xl text-blood-400 w-6 text-center">{custom.wolfCount}</span>
                    <button onClick={() => adjustWolf(1)}
                      disabled={custom.wolfCount >= Math.floor((custom.maxPlayers - 1) / 2) - (custom.enabledExtras.has(Role.WOLF_KING) ? 1 : 0)}
                      className="w-8 h-8 rounded-lg bg-forest-50/50 flex items-center justify-center text-moon-dim hover:text-moon disabled:opacity-30 transition-colors">+</button>
                  </div>
                </div>
                {/* Wolf king */}
                {WOLF_EXTRAS.map(role => {
                  const enabled = custom.enabledExtras.has(role);
                  return (
                    <button key={role} onClick={() => toggleExtra(role)}
                      className={`w-full flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 ${enabled ? 'bg-blood/10 border border-blood/30' : 'glass hover:bg-white/[0.06]'}`}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${enabled ? 'bg-blood/20' : 'bg-forest-50/50'}`}>
                        {getRoleEmoji(role)}
                      </div>
                      <div className="text-left flex-1">
                        <div className={`text-sm font-body ${enabled ? 'text-blood-400' : 'text-moon-dim'}`}>{ROLES[role]?.name || role}</div>
                        <div className="text-[10px] text-moon-mist">{ROLES[role].skill}</div>
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${enabled ? 'border-blood bg-blood text-white' : 'border-white/20'}`}>
                        {enabled && <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 神职阵营 */}
            <div className="animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <p className="text-xs text-poison tracking-wider uppercase mb-3 flex items-center gap-2">
                <span>🔮</span> 神职阵营
                <span className="ml-auto font-display text-base text-poison">{currentCounts.gods}</span>
              </p>
              <div className="grid grid-cols-2 gap-2.5">
                {GOD_ROLES.map(role => {
                  const enabled = custom.enabledExtras.has(role);
                  const canHybrid = HYBRIDABLE_ROLES.includes(role);
                  const isHybrid = custom.hybridRoles.has(role);
                  return (
                    <div key={role} className="relative">
                      <button onClick={() => toggleExtra(role)}
                        className={`w-full flex items-center gap-3 p-4 rounded-2xl transition-all duration-200 ${enabled ? 'bg-poison/10 border border-poison/30' : 'glass hover:bg-white/[0.06]'}`}>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${enabled ? 'bg-poison/20' : 'bg-forest-50/50'}`}>
                          {getRoleEmoji(role)}
                        </div>
                        <div className="text-left">
                          <div className={`text-sm font-body ${enabled ? 'text-poison' : 'text-moon-dim'}`}>{ROLES[role]?.name || role}</div>
                          <div className="text-[10px] text-moon-mist">{ROLES[role].skill}</div>
                        </div>
                        <div className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${enabled ? 'border-poison bg-poison text-white' : 'border-white/20'}`}>
                          {enabled && <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>}
                        </div>
                      </button>
                      {enabled && canHybrid && (
                        <button onClick={(e) => { e.stopPropagation(); toggleHybrid(role); }}
                          className={`absolute -top-1.5 -right-1.5 px-1.5 py-0.5 rounded-md text-[9px] tracking-wider transition-all ${isHybrid ? 'bg-gold/20 text-gold border border-gold/30' : 'bg-forest-50/80 text-moon-mist border border-white/[0.06]'}`}>
                          神民
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 平民阵营 */}
            <div className="animate-slide-up" style={{ animationDelay: '0.15s' }}>
              <p className="text-xs text-heal tracking-wider uppercase mb-3 flex items-center gap-2">
                <span>👤</span> 平民阵营
                <span className="ml-auto font-display text-base text-heal">{currentCounts.villagers}</span>
              </p>
              <div className="glass rounded-2xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-heal/10 flex items-center justify-center text-lg">👤</div>
                    <div>
                      <div className="text-sm text-moon">村民</div>
                      <div className="text-[10px] text-moon-mist">自动填充</div>
                    </div>
                  </div>
                  <div className={`font-display text-2xl ${currentCounts.villagers < 1 ? 'text-blood-400' : 'text-heal'}`}>
                    {currentCounts.villagers}
                  </div>
                </div>
              </div>
            </div>

            {/* Validation */}
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
        <div className="mx-5 mb-2 px-4 py-3 rounded-xl bg-blood/10 border border-blood/20 text-blood-400 text-sm text-center animate-slide-up">{error}</div>
      )}

      {/* Bottom Action */}
      <div className="px-5 pb-safe pt-2 pb-4 relative z-10">
        <button onClick={handleCreate} disabled={!pendingName || !validation.valid}
          className="group relative w-full py-4 rounded-2xl font-display text-lg tracking-wide overflow-hidden transition-all duration-300 disabled:opacity-30 disabled:cursor-not-allowed">
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
    [Role.VILLAGER]: '👤', [Role.WEREWOLF]: '🐺', [Role.WOLF_KING]: '👑',
    [Role.SEER]: '🔮', [Role.WITCH]: '🧪', [Role.HUNTER]: '🔫', [Role.GUARD]: '🛡️',
  };
  return emojis[role] || '❓';
}
