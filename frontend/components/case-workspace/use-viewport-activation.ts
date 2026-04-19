"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type UseViewportActivationArgs = {
  rootMargin?: number;
};

function elementIsNearViewport(element: Element, margin: number) {
  if (typeof window === "undefined") {
    return true;
  }
  const rect = element.getBoundingClientRect();
  const viewportHeight =
    window.innerHeight ||
    document.documentElement.clientHeight ||
    0;
  return rect.top <= viewportHeight + margin && rect.bottom >= -margin;
}

export function useViewportActivation<T extends Element>({
  rootMargin = 320,
}: UseViewportActivationArgs = {}) {
  const elementRef = useRef<T | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const [isActive, setIsActive] = useState(typeof window === "undefined");

  const disconnectObserver = useCallback(() => {
    observerRef.current?.disconnect();
    observerRef.current = null;
  }, []);

  const activationRef = useCallback(
    (node: T | null) => {
      disconnectObserver();
      elementRef.current = node;
      if (!node || isActive || typeof window === "undefined") {
        return;
      }
      if (elementIsNearViewport(node, rootMargin)) {
        setIsActive(true);
        return;
      }
      if (typeof window.IntersectionObserver !== "function") {
        setIsActive(true);
        return;
      }
      const observer = new window.IntersectionObserver(
        (entries) => {
          if (
            entries.some(
              (entry) => entry.isIntersecting || entry.intersectionRatio > 0,
            )
          ) {
            setIsActive(true);
            disconnectObserver();
          }
        },
        {
          rootMargin: `${rootMargin}px 0px ${rootMargin}px 0px`,
        },
      );
      observer.observe(node);
      observerRef.current = observer;
    },
    [disconnectObserver, isActive, rootMargin],
  );

  useEffect(() => {
    return () => {
      disconnectObserver();
    };
  }, [disconnectObserver]);

  return {
    activationRef,
    isActive,
  };
}
