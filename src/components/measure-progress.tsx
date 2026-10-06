"use client";

import { useEffect, useRef, useState } from "react";

// Counts filled measurement fields of the enclosing evaluation form.
export function MeasureProgress({ total }: { total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [filled, setFilled] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const update = () =>
      setFilled(
        [
          ...form.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
            '[name^="trait:"]',
          ),
        ].filter((field) => field.value.trim() !== "").length,
      );
    update();
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("reset", () => window.setTimeout(update, 0));
    return () => {
      form.removeEventListener("input", update);
      form.removeEventListener("change", update);
    };
  }, []);
  return (
    <div className="measure-progress" ref={ref} aria-live="polite">
      <span>
        {filled} / {total} mesure{total > 1 ? "s" : ""} renseignée
        {filled > 1 ? "s" : ""}
      </span>
      <span className="pipeline-bar" aria-hidden="true">
        <span style={{ width: `${total ? (filled / total) * 100 : 0}%` }} />
      </span>
    </div>
  );
}
