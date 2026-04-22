"use client";

/**
 * Copilot Context Capture
 * ----------------------------------------------------------------
 * - useCurrentSection(): IntersectionObserver로 [data-tour="..."] 요소 중
 *   뷰포트에서 가장 크게 보이는 섹션 id를 반환.
 * - CopilotContextBridge: section/state를 React Context로 내려줘
 *   CuttingCopilot 및 하위 컴포넌트에서 useCopilotContext()로 사용.
 */

import * as React from "react";

interface CopilotContextValue {
  section?: string;
  state?: unknown;
}

const CopilotCtx = React.createContext<CopilotContextValue>({});

export function useCopilotContext(): CopilotContextValue {
  return React.useContext(CopilotCtx);
}

interface BridgeProps {
  section?: string;
  state?: unknown;
  children: React.ReactNode;
}

export function CopilotContextBridge({ section, state, children }: BridgeProps) {
  const value = React.useMemo<CopilotContextValue>(
    () => ({ section, state }),
    [section, state],
  );
  return <CopilotCtx.Provider value={value}>{children}</CopilotCtx.Provider>;
}

/**
 * useCurrentSection
 * 화면에서 현재 가장 많이 보이는 [data-tour="..."] 요소의 값을 반환.
 * SSR 안전: window 없을 때 undefined 반환.
 */
export function useCurrentSection(): string | undefined {
  const [section, setSection] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof IntersectionObserver === "undefined") return;

    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-tour]"),
    ).filter((el) => {
      const id = el.getAttribute("data-tour");
      return !!id && id !== "copilot-trigger";
    });

    if (nodes.length === 0) return;

    const ratioMap = new Map<string, number>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).getAttribute("data-tour");
          if (!id) continue;
          ratioMap.set(id, entry.intersectionRatio);
        }
        // pick id with max visible ratio
        let bestId: string | undefined;
        let bestRatio = 0;
        ratioMap.forEach((r, id) => {
          if (r > bestRatio) {
            bestRatio = r;
            bestId = id;
          }
        });
        if (bestId && bestRatio > 0.15) {
          setSection((cur) => (cur === bestId ? cur : bestId));
        }
      },
      {
        threshold: [0, 0.15, 0.3, 0.5, 0.75, 1],
      },
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  return section;
}

export default CopilotContextBridge;
