import type { ImgHTMLAttributes } from "react";

type DesktopImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
  alt: string;
  fill?: boolean;
  priority?: boolean;
};

function normalizeImageSrc(src: string) {
  if (!src.startsWith("/")) {
    return src;
  }
  return `.${src}`;
}

export default function Image({ src, alt, fill, priority, ...props }: DesktopImageProps) {
  const normalizedSrc = normalizeImageSrc(src);
  if (fill) {
    return <img alt={alt} src={normalizedSrc} {...props} />;
  }
  return <img alt={alt} src={normalizedSrc} {...props} />;
}
