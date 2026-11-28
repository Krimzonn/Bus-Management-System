import { useEffect, useRef } from "react";

// Accessible modal used for the details drawer, the form and confirmations.
// A shared stack means that when dialogs are nested (for example a confirmation
// on top of the drawer) only the top one reacts to Escape and Tab.

const stack = [];
let savedOverflow = "";

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, a[href], [tabindex]:not([tabindex="-1"])';

export default function MaintenanceDialog({
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

  useEffect(() => {
    closeRef.current = onClose;
    dismissibleRef.current = dismissible;
  });

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
        if (dismissibleRef.current) closeRef.current();
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
  }, []);

  return (
    <div
      className={`mt-overlay mt-overlay-${variant}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div
        className={`mt-dialog mt-dialog-${variant}`}
        role={variant === "confirm" ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        ref={panelRef}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}