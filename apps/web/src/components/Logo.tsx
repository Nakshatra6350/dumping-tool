import { useId } from "react";

/**
 * The DBRB logo, drawn inline so it follows the theme and needs no image
 * requests. Geometry is identical to docs/brand (see docs/BRAND.md).
 */
const D_PATH =
  "M28 16H60A48 48 0 0 1 60 112H28A8 8 0 0 1 20 104V24A8 8 0 0 1 28 16ZM42.5 64L56 42H62A22 22 0 0 1 62 86H56Z";

const ICON_D_PATH =
  "M38.8 30.4H61.2A33.6 33.6 0 0 1 61.2 97.6H38.8A5.6 5.6 0 0 1 33.2 92V36A5.6 5.6 0 0 1 38.8 30.4ZM48.95 64L58.4 48.6H62.6A15.4 15.4 0 0 1 62.6 79.4H58.4Z";

/** The "Return D" mark in the brand gradient. */
export const LogoMark = ({ size = 32 }: { size?: number }) => {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" role="img" aria-label="DBRB">
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="20" y1="16" x2="108" y2="112">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <path fill={`url(#${id})`} fillRule="evenodd" d={D_PATH} />
    </svg>
  );
};

/** The white mark on the gradient tile: used in the sidebar and as the app icon. */
export const AppIcon = ({ size = 32 }: { size?: number }) => {
  const id = useId();
  return (
    <svg className="app-icon" width={size} height={size} viewBox="0 0 128 128" role="img" aria-label="DBRB">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="30" fill={`url(#${id})`} />
      <path fill="#fff" fillRule="evenodd" d={ICON_D_PATH} />
    </svg>
  );
};

/** The custom "DBRB" lettering. Takes its colour from the surrounding text. */
export const Wordmark = ({ height = 16 }: { height?: number }) => {
  const id = useId();
  return (
    <svg height={height} viewBox="0 6 142 44" role="img" aria-label="DBRB" style={{ display: "block" }}>
      <defs>
        <clipPath id={id}>
          <rect x="-2" y="8" width="146" height="40" />
        </clipPath>
      </defs>
      <g
        clipPath={`url(#${id})`}
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      >
        <path d="M4 12H14A16 16 0 0 1 14 44H4Z" />
        <path d="M46 52V12H55A8 8 0 0 1 55 28H46M46 28H57A8 8 0 0 1 57 44H46" />
        <path d="M81 52V12H90A8 8 0 0 1 90 28H81M88 28L101 52" />
        <path d="M118 52V12H127A8 8 0 0 1 127 28H118M118 28H129A8 8 0 0 1 129 44H118" />
      </g>
    </svg>
  );
};

/** Icon + wordmark, as used in the sidebar and on the sign-in pages. */
export const BrandLockup = ({
  iconSize = 30,
  wordmarkHeight = 15,
}: {
  iconSize?: number;
  wordmarkHeight?: number;
}) => (
  <span className="brand-lockup">
    <AppIcon size={iconSize} />
    <Wordmark height={wordmarkHeight} />
  </span>
);
