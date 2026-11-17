import type { Progress } from '../import';

export default function ImportProgress({ progress }: { progress: Progress | null }) {
  if (!progress) return null;
  return (
    <div className="overlay" role="status" aria-live="polite">
      <div className="overlay-card">
        <div>Importing {progress.file}</div>
        {progress.pages > 0 ? (
          <>
            <div className="muted">
              {progress.unit} {progress.page} of {progress.pages}
            </div>
            <progress value={progress.page} max={progress.pages} />
          </>
        ) : (
          <>
            <div className="muted">Reading file…</div>
            <progress />
          </>
        )}
      </div>
    </div>
  );
}
