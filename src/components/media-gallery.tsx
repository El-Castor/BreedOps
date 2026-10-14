"use client";

import { useEffect, useRef, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { FormDrawer } from "@/components/form-drawer";
import { Icon } from "@/components/icons";
import {
  archiveMediaAction,
  listMedia,
  restoreMediaAction,
  setMediaPrimaryAction,
  updateMediaMetadata,
  uploadMedia,
} from "@/lib/media/actions";
import {
  mediaKindLabels,
  mediaKinds,
  type MediaAsset,
  type MediaTargetType,
} from "@/lib/media/types";

/** Drops a photo gallery into a row or list that has no dedicated detail
 * view of its own (e.g. a phenotype evaluation), without redesigning it. */
export function MediaGalleryDrawer({
  targetType,
  targetId,
  title,
}: {
  targetType: MediaTargetType;
  targetId: string;
  title: string;
}) {
  return (
    <FormDrawer label="Photos" title={title} icon="image" variant="secondary">
      <MediaGallery targetType={targetType} targetId={targetId} />
    </FormDrawer>
  );
}

export function MediaGallery({
  targetType,
  targetId,
}: {
  targetType: MediaTargetType;
  targetId: string;
}) {
  const [items, setItems] = useState<MediaAsset[] | null>(null);
  const [canUpload, setCanUpload] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);
    listMedia(targetType, targetId, showArchived).then((result) => {
      if (!active) return;
      if ("error" in result) {
        setError(result.error);
        setItems([]);
        return;
      }
      setItems(result.items);
      setCanUpload(result.canUpload);
    });
    return () => {
      active = false;
    };
  }, [targetType, targetId, showArchived]);

  return (
    <section>
      <h3 className="icon-heading">
        <Icon name="image" size={14} />
        Images
      </h3>
      <div className="media-toolbar">
        <button
          type="button"
          className="secondary media-archives-toggle"
          aria-pressed={showArchived}
          onClick={() => setShowArchived((value) => !value)}
        >
          <Icon name={showArchived ? "restore" : "archive"} size={14} />
          {showArchived ? "Masquer les archives" : "Afficher les archives"}
        </button>
        <UploadDrawer
          targetType={targetType}
          targetId={targetId}
          disabled={!canUpload}
        />
      </div>
      {error && <p className="form-message error">{error}</p>}
      {items === null && !error && (
        <p className="inspector-note">Chargement…</p>
      )}
      {items !== null && items.length === 0 && !error && (
        <div className="media-empty">
          <Icon name="image" />
          <p>
            {showArchived
              ? "Aucune image archivée."
              : "Aucune image enregistrée."}
          </p>
        </div>
      )}
      {items !== null && items.length > 0 && (
        <ul className="media-grid">
          {items.map((item, index) => (
            <MediaItem
              key={item.id}
              item={item}
              onView={() => setViewerIndex(index)}
            />
          ))}
        </ul>
      )}
      {items !== null && viewerIndex !== null && (
        <MediaViewer
          items={items}
          index={viewerIndex}
          onClose={() => setViewerIndex(null)}
          onNavigate={setViewerIndex}
        />
      )}
    </section>
  );
}

function MediaItem({ item, onView }: { item: MediaAsset; onView: () => void }) {
  const archived = Boolean(item.archivedAt);
  return (
    <li className={`media-tile${archived ? " archived" : ""}`}>
      <button
        type="button"
        className="media-thumb"
        onClick={onView}
        aria-label={`Voir l’image ${item.caption ?? item.originalFilename}`}
      >
        {item.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.signedUrl} alt={item.caption ?? ""} loading="lazy" />
        ) : (
          <Icon name="image" />
        )}
        {item.isPrimary && (
          <span className="media-primary-badge" title="Image principale">
            <Icon name="primary" size={12} />
          </span>
        )}
        {archived && <span className="media-archived-badge">Archivé</span>}
      </button>
      <div className="media-caption">
        {item.caption || mediaKindLabels[item.mediaKind ?? "other"]}
      </div>
      <MediaItemActions item={item} />
    </li>
  );
}

function MediaItemActions({ item }: { item: MediaAsset }) {
  const archived = Boolean(item.archivedAt);
  return (
    <div className="media-item-actions">
      {!archived && !item.isPrimary && (
        <ActionForm
          action={setMediaPrimaryAction}
          actionName={`media-primary-${item.id}`}
          className="media-inline-form"
          submitLabel="Définir comme image principale"
          submitContent={<Icon name="primary" size={14} />}
          resetOnSuccess={false}
        >
          <input type="hidden" name="media_id" value={item.id} />
        </ActionForm>
      )}
      {!archived && <EditDrawer item={item} />}
      <ActionForm
        action={archived ? restoreMediaAction : archiveMediaAction}
        actionName={`media-lifecycle-${item.id}`}
        className="media-inline-form"
        submitLabel={archived ? "Restaurer" : "Archiver"}
        submitContent={
          <Icon name={archived ? "restore" : "archive"} size={14} />
        }
        resetOnSuccess={false}
      >
        <input type="hidden" name="media_id" value={item.id} />
      </ActionForm>
    </div>
  );
}

function EditDrawer({ item }: { item: MediaAsset }) {
  return (
    <FormDrawer
      label="Modifier"
      title="Modifier l’image"
      description={item.originalFilename}
      icon="edit"
      variant="secondary"
    >
      <ActionForm
        action={updateMediaMetadata}
        actionName={`media-edit-${item.id}`}
        submitLabel="Enregistrer"
        resetOnSuccess={false}
      >
        <input type="hidden" name="media_id" value={item.id} />
        <label>
          Légende
          <input
            name="caption"
            defaultValue={item.caption ?? ""}
            maxLength={500}
          />
        </label>
        <label>
          Type
          <select name="media_kind" defaultValue={item.mediaKind ?? ""}>
            <option value="">Non précisé</option>
            {mediaKinds.map((kind) => (
              <option key={kind} value={kind}>
                {mediaKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date de prise de vue
          <input
            type="date"
            name="captured_at"
            defaultValue={item.capturedAt ?? ""}
          />
        </label>
      </ActionForm>
    </FormDrawer>
  );
}

function UploadDrawer({
  targetType,
  targetId,
  disabled,
}: {
  targetType: MediaTargetType;
  targetId: string;
  disabled: boolean;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);
  return (
    <FormDrawer
      label="Ajouter une image"
      title="Ajouter une image"
      description="JPEG, PNG ou WebP, 10 Mo maximum."
      icon="upload"
      disabled={disabled}
      disabledReason="Cette entité est archivée : aucune nouvelle image ne peut y être ajoutée."
    >
      <ActionForm
        action={uploadMedia}
        actionName={`media-upload-${targetType}-${targetId}`}
        submitLabel="Ajouter l’image"
        resetOnSuccess={false}
      >
        <input type="hidden" name="target_type" value={targetType} />
        <input type="hidden" name="target_id" value={targetId} />
        <label>
          Image
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            required
            onChange={(event) => {
              setPreview((previous) => {
                if (previous) URL.revokeObjectURL(previous);
                const file = event.target.files?.[0];
                return file ? URL.createObjectURL(file) : null;
              });
            }}
          />
        </label>
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Aperçu" className="media-upload-preview" />
        )}
        <label>
          Légende
          <input name="caption" maxLength={500} />
        </label>
        <label>
          Type
          <select name="media_kind" defaultValue="">
            <option value="">Non précisé</option>
            {mediaKinds.map((kind) => (
              <option key={kind} value={kind}>
                {mediaKindLabels[kind]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date de prise de vue
          <input type="date" name="captured_at" />
        </label>
        <label className="checkbox-field">
          <input type="checkbox" name="is_primary" value="true" />
          Définir comme image principale
        </label>
      </ActionForm>
    </FormDrawer>
  );
}

function MediaViewer({
  items,
  index,
  onClose,
  onNavigate,
}: {
  items: MediaAsset[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const item = items[index];
  if (!item) return null;
  return (
    <dialog
      ref={dialog}
      className="media-viewer"
      aria-label={item.caption ?? item.originalFilename}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) dialog.current?.close();
      }}
      onKeyDown={(event) => {
        // Let the native dialog handle its own Escape-to-close, but don't
        // let the key reach the entity inspector's Escape handler too.
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <div className="media-viewer-panel">
        <button
          type="button"
          className="icon-button media-viewer-close"
          aria-label="Fermer"
          onClick={() => dialog.current?.close()}
        >
          <Icon name="close" />
        </button>
        {index > 0 && (
          <button
            type="button"
            className="media-viewer-nav previous"
            aria-label="Image précédente"
            onClick={() => onNavigate(index - 1)}
          >
            <Icon name="previous" />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            type="button"
            className="media-viewer-nav next"
            aria-label="Image suivante"
            onClick={() => onNavigate(index + 1)}
          >
            <Icon name="next" />
          </button>
        )}
        {item.signedUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.signedUrl} alt={item.caption ?? ""} />
        ) : (
          <div className="media-empty">
            <Icon name="image" />
            <p>Image indisponible.</p>
          </div>
        )}
        {item.caption && <p className="media-viewer-caption">{item.caption}</p>}
      </div>
    </dialog>
  );
}
