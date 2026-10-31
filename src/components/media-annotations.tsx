"use client";

import { useRef, useState, type MouseEvent } from "react";
import { ActionForm } from "@/components/action-form";
import { Icon } from "@/components/icons";
import {
  archiveAnnotationAction,
  createAnnotationAction,
  restoreAnnotationAction,
  updateAnnotationAction,
} from "@/lib/media/actions";
import {
  annotationTypeLabels,
  annotationTypes,
  type AnnotationType,
  type MediaAnnotation,
} from "@/lib/media/types";

/** Absolutely-positioned overlay using percentage coordinates (not pixels),
 * so it stays correct at any display size without a resize listener - the
 * browser's own layout recomputes the percentages. */
export function AnnotationOverlay({
  annotations,
  visible,
}: {
  annotations: MediaAnnotation[];
  visible: boolean;
}) {
  if (!visible || annotations.length === 0) return null;
  return (
    <div className="annotation-overlay" aria-hidden="true">
      {annotations.map((item) => (
        <span
          key={item.id}
          className={`annotation-mark annotation-${item.annotationType}`}
          style={
            item.annotationType === "rectangle"
              ? {
                  left: `${item.x * 100}%`,
                  top: `${item.y * 100}%`,
                  width: `${(item.width ?? 0) * 100}%`,
                  height: `${(item.height ?? 0) * 100}%`,
                }
              : { left: `${item.x * 100}%`, top: `${item.y * 100}%` }
          }
        />
      ))}
    </div>
  );
}

/** The textual equivalent required for accessibility: every annotation is
 * always listed as plain text/controls, never only as a hover/color mark
 * on the image. */
export function AnnotationList({
  annotations,
  canWrite,
}: {
  annotations: MediaAnnotation[];
  canWrite: boolean;
}) {
  if (annotations.length === 0)
    return <p className="inspector-note">Aucune annotation sur cette image.</p>;
  return (
    <ul className="annotation-list" role="list">
      {annotations.map((item) => (
        <li key={item.id} className="annotation-list-item">
          <span className="annotation-list-label">
            <strong>{annotationTypeLabels[item.annotationType]}</strong>
            {item.label && <> — « {item.label} »</>}
          </span>
          {canWrite && (
            <div className="annotation-item-actions">
              <EditAnnotationForm annotation={item} />
              <ActionForm
                action={archiveAnnotationAction}
                actionName={`annotation-archive-${item.id}`}
                className="media-inline-form"
                submitLabel="Retirer l’annotation"
                submitContent={<Icon name="archive" size={14} />}
                resetOnSuccess={false}
              >
                <input type="hidden" name="annotation_id" value={item.id} />
              </ActionForm>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ArchivedAnnotationList({
  annotations,
  canWrite,
}: {
  annotations: MediaAnnotation[];
  canWrite: boolean;
}) {
  if (annotations.length === 0) return null;
  return (
    <ul className="annotation-list annotation-list-archived" role="list">
      {annotations.map((item) => (
        <li key={item.id} className="annotation-list-item">
          <span className="annotation-list-label">
            <strong>{annotationTypeLabels[item.annotationType]}</strong>
            {item.label && <> — « {item.label} »</>}
            <span className="media-archived-badge">Archivée</span>
          </span>
          {canWrite && (
            <ActionForm
              action={restoreAnnotationAction}
              actionName={`annotation-restore-${item.id}`}
              className="media-inline-form"
              submitLabel="Restaurer l’annotation"
              submitContent={<Icon name="restore" size={14} />}
              resetOnSuccess={false}
            >
              <input type="hidden" name="annotation_id" value={item.id} />
            </ActionForm>
          )}
        </li>
      ))}
    </ul>
  );
}

function EditAnnotationForm({ annotation }: { annotation: MediaAnnotation }) {
  return (
    <ActionForm
      action={updateAnnotationAction}
      actionName={`annotation-edit-${annotation.id}`}
      className="media-inline-form annotation-edit-form"
      submitLabel="Enregistrer"
      resetOnSuccess={false}
    >
      <input type="hidden" name="annotation_id" value={annotation.id} />
      <label className="sr-only" htmlFor={`annotation-label-${annotation.id}`}>
        Texte de l’annotation
      </label>
      <input
        id={`annotation-label-${annotation.id}`}
        name="label"
        defaultValue={annotation.label ?? ""}
        maxLength={300}
        placeholder="Texte de l’annotation"
      />
    </ActionForm>
  );
}

/** Two ways to place a new annotation, both ending in the same form
 * submission: click on the image (point/text: one click; rectangle: two
 * clicks for opposite corners), or type normalized coordinates directly -
 * the keyboard- and screen-reader-accessible path that pointer placement
 * cannot provide on its own. */
export function AddAnnotationForm({
  mediaId,
  imageUrl,
  existingAnnotations,
}: {
  mediaId: string;
  imageUrl: string | null;
  existingAnnotations: MediaAnnotation[];
}) {
  const [type, setType] = useState<AnnotationType>("point");
  const [corner, setCorner] = useState<{ x: number; y: number } | null>(null);
  const [coords, setCoords] = useState({ x: "", y: "", width: "", height: "" });
  const imageArea = useRef<HTMLDivElement>(null);

  function normalizedFromClick(event: MouseEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    const y = Math.min(
      1,
      Math.max(0, (event.clientY - rect.top) / rect.height),
    );
    return { x, y };
  }

  function handleClick(event: MouseEvent<HTMLDivElement>) {
    const point = normalizedFromClick(event);
    if (type !== "rectangle") {
      setCoords({
        x: point.x.toFixed(4),
        y: point.y.toFixed(4),
        width: "",
        height: "",
      });
      return;
    }
    if (!corner) {
      setCorner(point);
      return;
    }
    const x = Math.min(corner.x, point.x);
    const y = Math.min(corner.y, point.y);
    const width = Math.abs(point.x - corner.x);
    const height = Math.abs(point.y - corner.y);
    setCoords({
      x: x.toFixed(4),
      y: y.toFixed(4),
      width: width.toFixed(4),
      height: height.toFixed(4),
    });
    setCorner(null);
  }

  return (
    <div className="annotation-add">
      <fieldset className="annotation-type-choice">
        <legend>Type d’annotation</legend>
        {annotationTypes.map((value) => (
          <label key={value} className="radio-field">
            <input
              type="radio"
              name="annotation-type-choice"
              value={value}
              checked={type === value}
              onChange={() => {
                setType(value);
                setCorner(null);
                setCoords({ x: "", y: "", width: "", height: "" });
              }}
            />
            {annotationTypeLabels[value]}
          </label>
        ))}
      </fieldset>
      <div
        ref={imageArea}
        className="annotation-click-surface"
        role="button"
        tabIndex={0}
        aria-label="Cliquez sur l’image pour placer l’annotation, ou saisissez les coordonnées ci-dessous"
        onClick={handleClick}
      >
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" />
        ) : (
          <Icon name="image" />
        )}
        <AnnotationOverlay annotations={existingAnnotations} visible />
        {type === "rectangle" && corner && (
          <span
            className="annotation-mark annotation-point annotation-pending-corner"
            style={{ left: `${corner.x * 100}%`, top: `${corner.y * 100}%` }}
          />
        )}
        <p className="annotation-click-hint">
          {type === "rectangle"
            ? corner
              ? "Cliquez sur le second coin de la zone."
              : "Cliquez sur un premier coin de la zone."
            : "Cliquez sur l’image pour placer l’annotation."}
        </p>
      </div>
      <ActionForm
        action={createAnnotationAction}
        actionName={`annotation-create-${mediaId}`}
        className="form annotation-coordinates-form"
        submitLabel="Ajouter l’annotation"
        resetOnSuccess={false}
      >
        <input type="hidden" name="media_id" value={mediaId} />
        <input type="hidden" name="annotation_type" value={type} />
        <details className="annotation-manual-coordinates">
          <summary>Saisir les coordonnées précisément (clavier)</summary>
          <div className="fields-2">
            <label>
              Position X (0–1)
              <input
                name="x"
                type="number"
                step="0.0001"
                min="0"
                max="1"
                required
                value={coords.x}
                onChange={(event) =>
                  setCoords((previous) => ({
                    ...previous,
                    x: event.target.value,
                  }))
                }
              />
            </label>
            <label>
              Position Y (0–1)
              <input
                name="y"
                type="number"
                step="0.0001"
                min="0"
                max="1"
                required
                value={coords.y}
                onChange={(event) =>
                  setCoords((previous) => ({
                    ...previous,
                    y: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          {type === "rectangle" && (
            <div className="fields-2">
              <label>
                Largeur (0–1)
                <input
                  name="width"
                  type="number"
                  step="0.0001"
                  min="0"
                  max="1"
                  required
                  value={coords.width}
                  onChange={(event) =>
                    setCoords((previous) => ({
                      ...previous,
                      width: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Hauteur (0–1)
                <input
                  name="height"
                  type="number"
                  step="0.0001"
                  min="0"
                  max="1"
                  required
                  value={coords.height}
                  onChange={(event) =>
                    setCoords((previous) => ({
                      ...previous,
                      height: event.target.value,
                    }))
                  }
                />
              </label>
            </div>
          )}
        </details>
        <label>
          Texte {type === "text" ? "(requis)" : "(optionnel)"}
          <input name="label" maxLength={300} required={type === "text"} />
        </label>
      </ActionForm>
    </div>
  );
}
