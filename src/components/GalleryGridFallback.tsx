import type { PublicArtifact } from "../lib/gallery-api.ts";

// The plain collection, for reduced motion, no WebGL or a lost context: the
// same live records as the orbit, each a sleeve that opens the same view.
// It shows a bounded window: "See more" pages forward (retiring the earliest
// records), and once any were retired, a way back starts from the first.

type Props = {
  items: PublicArtifact[];
  hasMore: boolean;
  retired: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRestart: () => void;
  onOpen: (id: string, opener: HTMLButtonElement) => void;
};

export function GalleryGridFallback({ items, hasMore, retired, loadingMore, onLoadMore, onRestart, onOpen }: Props) {
  return (
    <div className="records-grid-wrap">
      <ul className="records-grid" aria-label="Records">
        {items.map((a) => (
          <li key={a.id}>
            <button type="button" className="records-tile" onClick={(e) => onOpen(a.id, e.currentTarget)}>
              <span className="sleeve">
                <img className="sleeve-image" src={a.image_url} alt={a.alt} width={a.width} height={a.height} loading="lazy" decoding="async" />
              </span>
              <span className="records-caption">{a.title}</span>
            </button>
          </li>
        ))}
      </ul>
      {(hasMore || retired) && (
        <div className="records-more">
          {retired && (
            <button type="button" className="button button-secondary" onClick={onRestart} disabled={loadingMore}>
              Back to the first records
            </button>
          )}
          {hasMore && (
            <button type="button" className="button button-secondary" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? "Opening more…" : "See more records"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
