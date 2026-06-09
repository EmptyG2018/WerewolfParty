import { PublicDeathReason, ReviewEvent } from '@werewolf/shared';

export type ReviewFilter = 'all' | 'night' | 'vote' | 'skill';

interface GroupedReviewEvents {
  day: number;
  events: ReviewEvent[];
}

interface ReviewDrawerProps {
  open: boolean;
  totalCount: number;
  groupedEvents: GroupedReviewEvents[];
  filter: ReviewFilter;
  filterOptions: Array<{ value: ReviewFilter; label: string }>;
  onFilterChange: (filter: ReviewFilter) => void;
  onClose: () => void;
  getPlayerNumberById: (playerId: string) => number;
  getPlayerName: (playerId: string | null) => string;
  getVoteTargetName: (playerId: string | null) => string;
  getReviewSummary: (event: ReviewEvent) => string;
  getReviewTagName: (event: ReviewEvent) => string;
  getReviewTagClass: (event: ReviewEvent) => string;
  getDeathReasonName: (reason: PublicDeathReason) => string;
  getDeathReasonClass: (reason: PublicDeathReason) => string;
}

export function ReviewDrawer({
  open,
  totalCount,
  groupedEvents,
  filter,
  filterOptions,
  onFilterChange,
  onClose,
  getPlayerNumberById,
  getPlayerName,
  getVoteTargetName,
  getReviewSummary,
  getReviewTagName,
  getReviewTagClass,
  getDeathReasonName,
  getDeathReasonClass
}: ReviewDrawerProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[58] flex items-end bg-black/55 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-h-[72dvh] rounded-t-3xl glass-dark p-4 overflow-y-auto animate-slide-in-bottom"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 mb-4">
          <div>
            <div className="text-[10px] text-moon-dim tracking-widest">复盘记录</div>
            <div className="font-display text-lg text-moon">{totalCount}条记录</div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full glass flex items-center justify-center text-moon-dim active:scale-95 transition-transform"
            aria-label="关闭复盘记录"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-4 gap-1.5 mb-4">
          {filterOptions.map(option => (
            <button
              key={option.value}
              onClick={() => onFilterChange(option.value)}
              className={`py-2 rounded-xl text-xs transition-colors ${
                filter === option.value
                  ? 'bg-gold/15 text-gold border border-gold/25'
                  : 'bg-white/[0.04] text-moon-mist border border-white/[0.04]'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="space-y-5">
          {groupedEvents.length === 0 ? (
            <div className="rounded-2xl bg-forest-50/40 border border-white/[0.04] p-4 text-center text-sm text-moon-mist">
              暂无记录
            </div>
          ) : groupedEvents.map(group => (
            <div key={group.day} className="space-y-2">
              <div className="sticky top-0 z-10 -mx-1 px-1 py-1 bg-forest/80 backdrop-blur-sm">
                <div className="text-[10px] text-moon-dim tracking-widest">第{group.day}天</div>
              </div>

              {group.events.map(event => {
                const voteRows = Object.entries(event.votes ?? {}).sort(([a], [b]) => {
                  return getPlayerNumberById(a) - getPlayerNumberById(b);
                });
                return (
                  <div key={event.id} className="rounded-2xl bg-forest-50/40 border border-white/[0.04] p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="text-xs text-moon-dim">{getReviewSummary(event)}</div>
                      </div>
                      <div className={`text-[10px] px-2 py-0.5 rounded-full border shrink-0 ${getReviewTagClass(event)}`}>
                        {getReviewTagName(event)}
                      </div>
                    </div>

                    {event.type === 'vote_result' && (
                      <>
                        <div className="space-y-1.5">
                          {voteRows.map(([voterId, targetId]) => (
                            <div key={voterId} className="flex items-center gap-2 text-xs">
                              <span className="w-24 shrink-0 text-moon truncate">{getPlayerName(voterId)}</span>
                              <span className="text-moon-mist">→</span>
                              <span className={targetId ? 'text-moon-dim truncate' : 'text-gold'}>
                                {getVoteTargetName(targetId)}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="mt-2 pt-2 border-t border-white/[0.04] flex flex-wrap gap-1.5">
                          {Object.entries(event.voteCount ?? {})
                            .sort((a, b) => b[1] - a[1])
                            .map(([targetId, count]) => (
                              <span key={targetId} className="text-[10px] px-2 py-0.5 rounded-lg bg-white/[0.04] text-moon-mist">
                                {getPlayerName(targetId)} {count}票
                              </span>
                            ))}
                          {(event.abstained ?? 0) > 0 && (
                            <span className="text-[10px] px-2 py-0.5 rounded-lg bg-gold/10 text-gold">
                              弃票 {event.abstained}票
                            </span>
                          )}
                        </div>
                      </>
                    )}

                    {event.deaths && event.deaths.length > 0 && event.type !== 'vote_result' && (
                      <div className="mt-2 pt-2 border-t border-white/[0.04] flex flex-wrap gap-1.5">
                        {event.deaths.map(death => (
                          <span key={`${event.id}-${death.playerId}`} className={`text-[10px] px-2 py-0.5 rounded-lg border ${getDeathReasonClass(death.reason)}`}>
                            {getPlayerName(death.playerId)} {getDeathReasonName(death.reason)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
