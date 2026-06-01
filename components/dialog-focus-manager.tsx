"use client";

import { useEffect } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visibleFocusableElements(dialog: HTMLElement) {
  return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter((element) => element.offsetParent !== null);
}

export default function DialogFocusManager() {
  useEffect(() => {
    let activeDialog: HTMLElement | undefined;
    let previouslyFocused: HTMLElement | undefined;

    function currentDialog() {
      return [...document.querySelectorAll<HTMLElement>("[aria-modal='true']")].at(-1);
    }

    function focusFirst(dialog: HTMLElement) {
      const target = dialog.querySelector<HTMLElement>("[autofocus]") ?? visibleFocusableElements(dialog)[0] ?? dialog;
      if (!dialog.hasAttribute("tabindex")) dialog.tabIndex = -1;
      target.focus();
    }

    function syncDialog() {
      const nextDialog = currentDialog();
      if (nextDialog === activeDialog) return;
      if (!activeDialog && nextDialog) previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
      activeDialog = nextDialog;
      if (activeDialog) requestAnimationFrame(() => activeDialog && focusFirst(activeDialog));
      else if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
        previouslyFocused = undefined;
      }
    }

    function keepFocusInside(event: FocusEvent) {
      if (activeDialog && event.target instanceof Node && !activeDialog.contains(event.target)) focusFirst(activeDialog);
    }

    function containTab(event: KeyboardEvent) {
      if (!activeDialog || event.key !== "Tab") return;
      const elements = visibleFocusableElements(activeDialog);
      if (!elements.length) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    const observer = new MutationObserver(syncDialog);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("focusin", keepFocusInside);
    document.addEventListener("keydown", containTab);
    syncDialog();
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", keepFocusInside);
      document.removeEventListener("keydown", containTab);
    };
  }, []);

  return null;
}
