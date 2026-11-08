"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { listComparableMedia } from "@/lib/media/actions";
import { capturePrecision } from "@/lib/media/temporal";
import {
  imagingModalityLabels,
  mediaKindLabels,
  viewpointLabels,
  type MediaAsset,
  type MediaTargetType,
} from "@/lib/media/types";

function formatCapture(item: MediaAsset): string {
  if (!item.capturedAt) return "Date inconnue";
  const date = new Date(item.capturedAt + "T00:00:00").toLocaleDateString(
    "fr-FR",
  );
  if (!item.capturedAtTime) return date;
  return `${date} ${item.capturedAtTime.slice(0, 5)}`;
}

/** Opt-in widening of the single-target gallery: a chronological timeline
 * across the whole biological target's history (never just this one
 * record's own photos for a phenotype_evaluation, see listComparableMedia),
 * plus a side-by-side comparison of exactly two selected images. Integrated
 * into the existing gallery as a drawer, not a separate application route. */
export function MediaTimelineDrawer({
  targetType,
  targetId,
}: {
  targetType: MediaTargetType;
  targetId: string;
}) {
  const [items, setItems] = useState<MediaAsset[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  // Deliberately lazy: fetched only once the drawer is actually opened
  // (own local state, not FormDrawer's), not on every gallery mount - the
  // broader cross-evaluation set and its signed URLs are extra work the
  // default grid view never needs.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setItems(null);
    setError(null);
    listComparableMedia(targetType, targetId, false).then((result) => {
      if (!active) return;
      if ("error" in result) {
        setError(result.error);
        setItems([]);
        return;
      }
      setItems(result.items);
    });
    return () => {
      active = false;
    };
  }, [open, targetType, targetId]);

  function toggle(id: string) {
    setSelected((previous) => {
      if (previous.includes(id))
        return previous.filter((value) => value !== id);
      if (previous.length >= 2) return [previous[1], id];
      return [...previous, id];
    });
  }

  const [imageA, imageB] = selected
    .map((id) => items?.find((item) => item.id === id))
    .filter((item): item is MediaAsset => Boolean(item));

  return (
    <>
      <button
        type="button"
        className="drawer-trigger secondary"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Icon name="history" />
        Chronologie et comparaison
      </button>
      <dialog
        ref={dialog}
        className="form-drawer"
        aria-label="Chronologie et comparaison"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") event.stopPropagation();
        }}
      >
        <div className="form-drawer-panel">
          <header>
            <div>
              <h2>Chronologie et comparaison</h2>
              <p>
                Images classées par date de prise de vue, les plus anciennes en
                premier.
              </p>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="Fermer"
              onClick={() => dialog.current?.close()}
            >
              <Icon name="close" />
            </button>
          </header>
          <div className="form-drawer-body">
            {error && <p className="form-message error">{error}</p>}
            {items === null && !error && (
              <p className="inspector-note">Chargement…</p>
            )}
            {items !== null && items.length === 0 && !error && (
              <p className="inspector-note">
                Aucune image pour cette chronologie.
              </p>
            )}
            {items !== null && items.length > 0 && (
              <>
                <p className="inspector-note">
                  Sélectionnez deux images pour les comparer côte à côte.
                </p>
                <ol className="media-timeline" role="list">
                  {items.map((item) => {
                    const precision = capturePrecision(item);
                    return (
                      <li key={item.id} className="media-timeline-item">
                        <label className="checkbox-field media-timeline-row">
                          <input
                            type="checkbox"
                            checked={selected.includes(item.id)}
                            onChange={() => toggle(item.id)}
                            aria-label={`Sélectionner l’image du ${formatCapture(item)} pour la comparaison`}
                          />
                          {item.signedUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.signedUrl}
                              alt=""
                              className="media-timeline-thumb"
                              loading="lazy"
                            />
                          ) : (
                            <Icon name="image" />
                          )}
                          <span className="media-timeline-meta">
                            <strong>
                              {formatCapture(item)}
                              {precision === "unknown" && " (date inconnue)"}
                            </strong>
                            <span>
                              {item.developmentalStage ||
                                mediaKindLabels[item.mediaKind ?? "other"]}
                              {item.viewpoint &&
                                ` · ${viewpointLabels[item.viewpoint]}`}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ol>
              </>
            )}
            {imageA && imageB && (
              <ComparisonPanel imageA={imageA} imageB={imageB} />
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}

function ComparisonPanel({
  imageA,
  imageB,
}: {
  imageA: MediaAsset;
  imageB: MediaAsset;
}) {
  return (
    <section
      className="media-comparison"
      aria-label="Comparaison des deux images"
    >
      <h3 className="icon-heading">
        <Icon name="history" size={14} />
        Comparaison
      </h3>
      <div className="media-comparison-grid">
        <ComparisonSide label="Image A" item={imageA} />
        <ComparisonSide label="Image B" item={imageB} />
      </div>
    </section>
  );
}

function ComparisonSide({ label, item }: { label: string; item: MediaAsset }) {
  return (
    <figure className="media-comparison-side">
      <figcaption>{label}</figcaption>
      {item.signedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.signedUrl} alt={item.caption ?? ""} />
      ) : (
        <Icon name="image" />
      )}
      <dl className="detail-list media-comparison-metadata">
        <div>
          <dt>Date de prise de vue</dt>
          <dd>{formatCapture(item)}</dd>
        </div>
        <div>
          <dt>Stade de développement</dt>
          <dd>{item.developmentalStage || "Non précisé"}</dd>
        </div>
        <div>
          <dt>Vue</dt>
          <dd>
            {item.viewpoint ? viewpointLabels[item.viewpoint] : "Non précisée"}
          </dd>
        </div>
        <div>
          <dt>Modalité</dt>
          <dd>
            {item.imagingModality
              ? imagingModalityLabels[item.imagingModality]
              : "Non précisée"}
          </dd>
        </div>
        <div>
          <dt>Légende</dt>
          <dd>{item.caption || "—"}</dd>
        </div>
        {item.scaleValue != null && (
          <div>
            <dt>Échelle</dt>
            <dd>
              {item.scaleValue} {item.scaleUnit}
              {item.scaleNote ? ` (${item.scaleNote})` : ""}
            </dd>
          </div>
        )}
      </dl>
    </figure>
  );
}
