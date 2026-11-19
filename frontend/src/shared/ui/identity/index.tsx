import { useState, type ReactNode } from "react";
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <img
      className="brand-mark"
      src={`${import.meta.env.BASE_URL}icon/vdaagent-mark.svg`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
export function Avatar({
  name,
  src,
  glyph,
  size = 36,
}: {
  name: string;
  src?: string;
  glyph?: ReactNode;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      className="avatar"
      aria-label={name}
      role="img"
      style={{ width: size, height: size }}
    >
      {src && !failed ? (
        <img src={src} alt="" onError={() => setFailed(true)} />
      ) : (
        (glyph ?? name.slice(0, 2).toUpperCase())
      )}
    </span>
  );
}
