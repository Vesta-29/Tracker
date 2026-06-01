"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type NavigateOptions = { replace?: boolean; scroll?: boolean; bypassGuard?: boolean };
type NavigationBlocker = { active: boolean; onBlocked: (href: string) => void };
type GuardedNavigationContextValue = {
  navigate: (href: string, options?: NavigateOptions) => boolean;
  registerBlocker: (id: symbol, blocker?: NavigationBlocker) => void;
};

const GuardedNavigationContext = createContext<GuardedNavigationContextValue | undefined>(undefined);

function currentHref() {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function GuardedNavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const blockersRef = useRef(new Map<symbol, NavigationBlocker>());
  const acceptedHrefRef = useRef("");
  const restoringHistoryRef = useRef(false);

  useEffect(() => {
    if (!restoringHistoryRef.current) acceptedHrefRef.current = currentHref();
  }, [pathname, searchParams]);

  useEffect(() => {
    acceptedHrefRef.current = currentHref();
    function onPopState() {
      if (restoringHistoryRef.current) {
        restoringHistoryRef.current = false;
        acceptedHrefRef.current = currentHref();
        return;
      }
      const blocker = [...blockersRef.current.values()].reverse().find((candidate) => candidate.active);
      const attemptedHref = currentHref();
      if (!blocker?.active || attemptedHref === acceptedHrefRef.current) {
        acceptedHrefRef.current = attemptedHref;
        return;
      }
      restoringHistoryRef.current = true;
      window.history.forward();
      blocker.onBlocked(attemptedHref);
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const registerBlocker = useCallback((id: symbol, blocker?: NavigationBlocker) => {
    if (blocker) blockersRef.current.set(id, blocker);
    else blockersRef.current.delete(id);
  }, []);

  const navigate = useCallback((href: string, options: NavigateOptions = {}) => {
    const blocker = [...blockersRef.current.values()].reverse().find((candidate) => candidate.active);
    if (!options.bypassGuard && blocker?.active) {
      blocker.onBlocked(href);
      return false;
    }
    if (options.replace) router.replace(href, { scroll: options.scroll });
    else router.push(href, { scroll: options.scroll });
    return true;
  }, [router]);

  const value = useMemo(() => ({ navigate, registerBlocker }), [navigate, registerBlocker]);
  return <GuardedNavigationContext.Provider value={value}>{children}</GuardedNavigationContext.Provider>;
}

export function useGuardedNavigation() {
  const context = useContext(GuardedNavigationContext);
  const router = useRouter();
  const unguardedNavigate = useCallback((href: string, options: NavigateOptions = {}) => {
    if (options.replace) router.replace(href, { scroll: options.scroll });
    else router.push(href, { scroll: options.scroll });
    return true;
  }, [router]);
  return context?.navigate ?? unguardedNavigate;
}

export function useNavigationBlocker(active: boolean, onBlocked: (href: string) => void) {
  const context = useContext(GuardedNavigationContext);
  const blockerIdRef = useRef(Symbol("navigation-blocker"));
  useEffect(() => {
    if (!context) return;
    const blockerId = blockerIdRef.current;
    context.registerBlocker(blockerId, { active, onBlocked });
    return () => context.registerBlocker(blockerId);
  }, [active, context, onBlocked]);
}
