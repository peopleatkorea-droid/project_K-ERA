import { useEffect } from "react";

type DesktopScriptProps = {
  src?: string;
  onLoad?: () => void;
};

export default function Script({ src, onLoad }: DesktopScriptProps) {
  useEffect(() => {
    if (!src) {
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[data-desktop-script="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") {
        onLoad?.();
        return;
      }
      const handleLoad = () => onLoad?.();
      existing.addEventListener("load", handleLoad, { once: true });
      return () => existing.removeEventListener("load", handleLoad);
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.desktopScript = src;
    const handleLoad = () => {
      script.dataset.loaded = "true";
      onLoad?.();
    };
    script.addEventListener("load", handleLoad, { once: true });
    document.head.appendChild(script);
    return () => {
      script.removeEventListener("load", handleLoad);
    };
  }, [onLoad, src]);

  return null;
}
