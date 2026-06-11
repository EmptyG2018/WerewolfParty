import { PHASE_DURATION_SECONDS, Role, ROLES, isWolfRole } from '@werewolf/shared';

interface RoleConfirmOverlayProps {
  role: Role;
  roleConfirmed: boolean;
  confirmedCount: number;
  totalPlayers: number;
  phaseTimer: number;
  roleConfirmTime?: number;
  isPaused: boolean;
  onConfirm: () => void;
}

export function RoleConfirmOverlay({
  role,
  roleConfirmed,
  confirmedCount,
  totalPlayers,
  phaseTimer,
  roleConfirmTime,
  isPaused,
  onConfirm
}: RoleConfirmOverlayProps) {
  const isWolf = isWolfRole(role);
  const progressBase = roleConfirmTime || PHASE_DURATION_SECONDS.roleConfirm;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-forest/95 backdrop-blur-sm">
      <div className="w-full max-w-sm">
        <div className="glass rounded-3xl p-6 text-center space-y-5">
          <div className="text-6xl">
            {isWolf ? '🐺' : '👤'}
          </div>

          <div>
            <div className="text-[10px] text-moon-dim tracking-widest mb-1">你的身份</div>
            <div className="font-display text-2xl text-white">{ROLES[role].name}</div>
          </div>

          <div className={`inline-block px-4 py-1.5 rounded-full text-xs font-medium tracking-wide ${
            isWolf
              ? 'bg-blood/20 text-blood-400 border border-blood/30'
              : 'bg-heal/20 text-heal-400 border border-heal/30'
          }`}>
            {isWolf ? '狼人阵营' : '好人阵营'}
          </div>

          <div className="glass-light rounded-2xl p-4 space-y-3">
            <div>
              <div className="text-[10px] text-moon-dim tracking-widest mb-1">角色介绍</div>
              <div className="text-sm text-moon leading-relaxed">{ROLES[role].description}</div>
            </div>
            <div className="h-px bg-white/5" />
            <div>
              <div className="text-[10px] text-moon-dim tracking-widest mb-1">技能</div>
              <div className="text-sm text-heal-400 font-medium">{ROLES[role].skill}</div>
            </div>
          </div>

          {roleConfirmed ? (
            <div className="space-y-1">
              <div className="text-heal-400 font-display text-sm">已确认</div>
              <div className="text-[10px] text-moon-dim">
                {confirmedCount}/{totalPlayers} 人已确认
              </div>
            </div>
          ) : (
            <button
              onClick={onConfirm}
              disabled={isPaused}
              className="w-full py-3.5 rounded-xl font-display text-base text-white
                bg-gradient-to-r from-heal-dark to-heal active:scale-[0.97]
                transition-transform shadow-lg shadow-heal/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              确认身份
            </button>
          )}

          <div className="space-y-2">
            <div className="text-[10px] text-moon-dim tracking-widest">自动进入夜晚</div>
            <div className="font-display text-4xl text-blood-400 animate-breathe">
              {phaseTimer}
            </div>
            <div className="w-full h-1 rounded-full bg-forest-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-blood-600 to-blood transition-all duration-1000"
                style={{ width: `${(phaseTimer / progressBase) * 100}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
