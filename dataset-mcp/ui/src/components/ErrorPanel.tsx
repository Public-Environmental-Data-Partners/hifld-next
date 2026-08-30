interface ErrorPanelProps {
  message: string;
  onDismiss?: () => void;
}
export function ErrorPanel({ message, onDismiss }: ErrorPanelProps) {
  return (
    <aside className="error-panel" role="alert">
      <strong>Something went wrong</strong>
      <span>{message}</span>
      {onDismiss ? (
        <button type="button" onClick={onDismiss}>
          Dismiss
        </button>
      ) : null}
    </aside>
  );
}
