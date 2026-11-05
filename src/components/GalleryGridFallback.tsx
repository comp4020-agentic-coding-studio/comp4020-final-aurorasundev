import type { PublicArtifact } from "../lib/gallery-api.ts";
import type { RecordTag } from "../lib/record-marks.ts";
import { useT } from "../lib/i18n.ts";

// The plain collection, for reduced motion, no WebGL or a lost context: the
// same live records as the orbit, each a sleeve that opens the same view.
// It shows a bounded window: "See more" pages forward (retiring the earliest
// records), and once any were retired, a way back starts from the first.

type Props = {
  items: PublicArtifact[];
  // the paper tag this browser shows on a record, if any
  tagFor?: (a: PublicArtifact) => RecordTag;
  hasMore: boolean;
  retired: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRestart: () => void;
  onOpen: (id: string, opener: HTMLButtonElement) => void;
};

export function GalleryGridFallback({ items, tagFor, hasMore, retired, loadingMore, onLoadMore, onRestart, onOpen }: Props) {
  const t = useT();
  return (
    <div className="records-grid-wrap">
      <ul className="records-grid" aria-label={t("Records")}>
        {items.map((a) => (
          <li key={a.id}>
            <button type="button" className="records-tile" onClick={(e) => onOpen(a.id, e.currentTarget)}>
              <span className="sleeve">
                <img className="sleeve-image" src={a.image_url} alt={t.alt(a.alt)} width={a.width} height={a.height} loading="lazy" decoding="async" />
              </span>
              {tagFor?.(a) && <span className="record-tag">{t(tagFor(a)!)}</span>}
              <span className="records-caption">{t.title(a.title)}</span>
            </button>
          </li>
        ))}
      </ul>
      {(hasMore || retired) && (
        <div className="records-more">
          {retired && (
            <button type="button" className="button button-secondary" onClick={onRestart} disabled={loadingMore}>
              {t("Back to the first records")}
            </button>
          )}
          {hasMore && (
            <button type="button" className="button button-secondary" onClick={onLoadMore} disabled={loadingMore}>
              {loadingMore ? t("Opening more…") : t("See more records")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
