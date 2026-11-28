import { useCallback, useEffect, useRef, useState } from "react";

// Accessible modal used for the details drawer, the form and confirmations.
// A shared stack means that when dialogs are nested only the top one reacts to
// Escape and Tab. `children` may be a function receiving close(), which plays a
// short exit animation before calling onClose.

const stack = [];
let savedOverflow = "";
const EXIT_MS = 180;

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])';

export default function ScheduleDialog({
  labelledBy,
  describedBy,
  onClose,
  dismissible = true,
  variant = "modal", // "modal" | "drawer" | "confirm"
  children,
}) {
  const panelRef = useRef(null);
  const closeRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const timerRef = useRef(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    closeRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

  const requestClose = useCallback(() => {
    if (timerRef.current) return;
    setClosing(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      closeRef.current();
      setClosing(false);
    }, EXIT_MS);
  }, []);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  useEffect(() => {
    const token = {};
    const previouslyFocused = document.activeElement;
    if (stack.length === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    stack.push(token);

    const panel = panelRef.current;
    const initial = panel?.querySelector("[data-autofocus]") ?? panel;
    initial?.focus();

    function handleKeyDown(event) {
      if (stack[stack.length - 1] !== token) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (dismissibleRef.current) requestClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!panelRef.current.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const index = stack.indexOf(token);
      if (index !== -1) stack.splice(index, 1);
      if (stack.length === 0) document.body.style.overflow = savedOverflow;
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [requestClose]);

  return (
    <div
      className={`sc-overlay sc-overlay-${variant}${closing ? " is-closing" : ""}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) requestClose();
      }}
    >
      <div
        className={`sc-dialog sc-dialog-${variant}`}
        role={variant === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        ref={panelRef}
        tabIndex={-1}
      >
        {typeof children === "function" ? children(requestClose) : children}
      </div>
    </div>
  );
}
