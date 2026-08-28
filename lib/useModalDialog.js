"use client";
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Wires up standard modal-dialog keyboard behavior for one of this site's
// overlays (gallery lightbox, sample modal, dashboard detail panel, custom
// quote modal): Escape closes it, Tab/Shift+Tab cycles focus among only the
// elements inside it instead of escaping into the page behind it, and focus
// moves into the dialog on open and back to whatever triggered it on close.
// Without this, a keyboard or screen-reader user opening any of these loses
// their place in the page entirely.
//
// `containerRef` must point at the dialog's outer content element (the one
// role="dialog" goes on, not the full-screen backdrop).
//
// Two ways to call this, both fine: from a component that's only ever
// mounted while the dialog is open (most modals here), or unconditionally
// from a parent that renders the dialog's markup conditionally itself --
// pass `isActive` tracking that same condition so the setup/teardown only
// runs across the actual open/close transition, not every render of the
// always-mounted parent.
export function useModalDialog(containerRef, onClose, isActive = true) {
  // Whether the caller passed isActive at all (not just its value) -- see the
  // comment on triggerElRef's cleanup below for why this distinction matters.
  // eslint-disable-next-line prefer-rest-params
  const isActiveManaged = arguments.length >= 3;

  // Read the latest onClose from a ref rather than the effect's own closure,
  // so the effect body itself only needs to run once per open, not on every
  // re-render while open -- re-running it would re-grab focus each time.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Captured during render, guarded so it only happens once per open --
  // deliberately NOT inside the effect below. React Strict Mode's dev-only
  // double-invoke of effects (mount -> cleanup -> mount, all synchronous)
  // means an effect-time capture can read document.activeElement AFTER the
  // synthetic cleanup has already moved focus itself, capturing the
  // dialog's own close button as the "trigger to restore focus to" instead
  // of whatever was focused on the page before the dialog opened -- render-
  // phase mutation of a ref (a React-sanctioned pattern) sidesteps that
  // entirely, since nothing moves focus during a pure render.
  const triggerElRef = useRef(null);
  if (isActive && triggerElRef.current === null) {
    triggerElRef.current = document.activeElement;
  }

  useEffect(() => {
    if (!isActive) return;

    const getFocusable = () => Array.from(containerRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) || []);
    // Focus the first focusable element (usually the close button) rather
    // than the dialog container itself -- more useful than announcing
    // "dialog" with nothing to immediately act on.
    getFocusable()[0]?.focus();

    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to whatever opened the dialog -- if it's gone from the
      // DOM by now (e.g. the underlying list re-rendered), .focus?. just
      // silently no-ops rather than throwing.
      triggerElRef.current?.focus?.();
      // Only reset the ref for callers that keep this hook mounted across
      // opens (the isActive pattern) -- they need it cleared so the next
      // open re-captures fresh. Callers that mount a fresh component per
      // open don't need this (a new instance gets a fresh ref naturally) and
      // resetting it here would actively break them: React Strict Mode's
      // dev-only double-invoke runs this same cleanup synthetically right
      // after initial mount, which would null out the ref before the dialog
      // is ever really closed, so the real close later finds nothing to
      // restore focus to.
      if (isActiveManaged) triggerElRef.current = null;
    };
  }, [containerRef, isActive]);
}
