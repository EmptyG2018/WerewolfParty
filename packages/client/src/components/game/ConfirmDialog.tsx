export type PendingConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'danger' | 'safe';
  run: () => void;
};

interface ConfirmDialogProps {
  confirm: PendingConfirm | null;
  onCancel: () => void;
}

export function ConfirmDialog({ confirm, onCancel }: ConfirmDialogProps) {
  if (!confirm) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="glass-dark rounded-3xl p-5 w-full max-w-xs animate-moonrise">
        <div className="text-center mb-4">
          <div className={`mx-auto mb-3 w-11 h-11 rounded-full flex items-center justify-center text-xl ${
            confirm.tone === 'danger' ? 'bg-blood/20 text-blood-400' : 'bg-heal/20 text-heal-400'
          }`}>
            {confirm.tone === 'danger' ? '!' : '✓'}
          </div>
          <h3 className="font-display text-xl text-moon mb-2">{confirm.title}</h3>
          <p className="text-sm text-moon-dim leading-relaxed">{confirm.message}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 py-3 rounded-xl glass text-moon-dim text-sm active:scale-[0.97] transition-transform"
          >
            取消
          </button>
          <button
            onClick={confirm.run}
            className={`flex-1 py-3 rounded-xl text-white font-display text-sm active:scale-[0.97] transition-transform ${
              confirm.tone === 'danger'
                ? 'bg-gradient-to-r from-blood-700 to-blood'
                : 'bg-gradient-to-r from-heal-dark to-heal'
            }`}
          >
            {confirm.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
