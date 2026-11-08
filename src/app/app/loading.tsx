export default function Loading() {
  return (
    <div className="loading-state skeleton" role="status" aria-live="polite">
      <span className="sr-only">Chargement de BreedOps…</span>
      <span className="wide" />
      <span />
      <span className="block" />
      <span className="block" />
    </div>
  );
}
