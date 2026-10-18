import type { PublicArtifact } from "../lib/gallery-api.ts";

// The plain collection, for reduced motion, no WebGL or a lost context: the
// same live records as the orbit, each a sleeve that opens the same view.

type Props = {
  items: PublicArtifact[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onOpen: (id: string, opener: HTMLButtonElement) => void;
};

export function GalleryGridFallback({ items, hasMore, loadingMore, onLoadMore, onOpen }: Props) {
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
      {hasMore && (
        <div className="records-more">
          <button type="button" className="button button-secondary" onClick={onLoadMore} disabled={loadingMore}>
            {loadingMore ? "Opening more…" : "See more records"}
          </button>
        </div>
      )}
    </div>
  );
}
