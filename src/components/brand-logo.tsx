import type { CSSProperties } from "react";

type BrandLogoProps = {
  size?: number;
  style?: CSSProperties;
};

/** 品牌 Logo：红棕圆角方块 + 金色 d20 + 角上蝴蝶结（小鞠发珠意象） */
export function BrandLogo({ size = 44, style }: BrandLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Komari Bot Console"
      style={style}
    >
      <rect width="64" height="64" rx="14" fill="#943A4D" />
      <rect
        x="2"
        y="2"
        width="60"
        height="60"
        rx="12"
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth="1.5"
      />
      <g
        fill="none"
        stroke="#E3A93C"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M32 13 L49.6 23.2 L49.6 41.8 L32 52 L14.4 41.8 L14.4 23.2 Z" />
        <path d="M32 13 L32 29" />
        <path d="M49.6 41.8 L36.5 35.5" />
        <path d="M14.4 41.8 L27.5 35.5" />
        <path d="M32 29 L36.5 35.5 L27.5 35.5 Z" />
      </g>
      <g fill="#E3A93C">
        <path d="M50 11 L42 5.5 L43.5 14.5 Z" />
        <path d="M50 11 L58 5.5 L56.5 14.5 Z" />
        <circle cx="50" cy="11" r="2.2" />
      </g>
    </svg>
  );
}

type D20IconProps = {
  size?: number;
  style?: CSSProperties;
  className?: string;
};

/** 纯 d20 描边轮廓，跟随 currentColor，供菜单/装饰复用 */
export function D20Icon({ size = 16, style, className }: D20IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={className}
      style={style}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M32 6 L56 20 L56 44 L32 58 L8 44 L8 20 Z" />
      <path d="M32 6 L32 27" />
      <path d="M56 44 L38.5 35" />
      <path d="M8 44 L25.5 35" />
      <path d="M32 27 L38.5 35 L25.5 35 Z" />
    </svg>
  );
}

type DaisyIconProps = {
  size?: number;
  style?: CSSProperties;
  className?: string;
};

/** 极简雏菊：白色花瓣 + 金色花心（小鞠 ED 水彩意象点缀） */
export function DaisyIcon({ size = 20, style, className }: DaisyIconProps) {
  const petals = Array.from({ length: 8 }, (_, index) => index * 45);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {petals.map((angle) => (
        <ellipse
          key={angle}
          cx="12"
          cy="6.2"
          rx="2.1"
          ry="4.4"
          fill="currentColor"
          transform={`rotate(${angle} 12 12)`}
        />
      ))}
      <circle cx="12" cy="12" r="3.1" fill="#E3A93C" />
    </svg>
  );
}
