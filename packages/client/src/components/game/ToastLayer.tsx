interface ToastLayerProps {
  message: string | null;
}

export function ToastLayer({ message }: ToastLayerProps) {
  if (!message) return null;

  return (
    <div className="fixed top-20 left-4 right-4 z-50 animate-slide-up">
      <div className="glass-dark rounded-2xl px-4 py-3 text-blood-400 text-sm text-center">
        {message}
      </div>
    </div>
  );
}
