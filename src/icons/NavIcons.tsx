import type { SVGProps } from "react";

type TSvgProps = SVGProps<SVGSVGElement>;

/** Arrow pointing left — used for the Back nav button. */
export function ArrowLeftIcon(props: TSvgProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M13 8H3M7 4L3 8L7 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Rotate-left icon — used for the Restart nav button. */
export function RotateLeftIcon(props: TSvgProps) {
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fill="currentColor"
        d="M80 115.2L80 160c15.2 0 30.5 0 45.7 0l17.1-17.1c62.5-62.5 163.8-62.5 226.3 0s62.5 163.8 0 226.3s-163.8 62.5-226.3 0c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3C141.3 458.1 198.7 480 256 480s114.7-21.9 158.4-65.6S480 313.3 480 256s-21.9-114.7-65.6-158.4S313.3 32 256 32S141.3 53.9 97.6 97.6L80 115.2zM16 192c0 17.7 14.3 32 32 32l128 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-96 0 0-96c0-17.7-14.3-32-32-32S16 46.3 16 64l0 128z"
      />
    </svg>
  );
}

/** FA sharp-regular layer-group — used for the Beats nav button. */
export function LayerGroupIcon(props: TSvgProps) {
  return (
    <svg
      viewBox="0 0 576 512"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fill="currentColor"
        d="M288 0c-8.5 0-17 1.7-24.8 5.1L53.9 94.8C40.6 100.5 32 113.5 32 128s8.6 27.5 21.9 33.2l209.3 89.7c7.8 3.4 16.3 5.1 24.8 5.1s17-1.7 24.8-5.1l209.3-89.7c13.3-5.7 21.9-18.8 21.9-33.2s-8.6-27.5-21.9-33.2L312.8 5.1C305 1.7 296.5 0 288 0zm-5.9 49.2C284 48.4 286 48 288 48s4 .4 5.9 1.2L477.7 128 293.9 206.8c-1.9 .8-3.9 1.2-5.9 1.2s-4-.4-5.9-1.2L98.3 128 282.1 49.2zM53.9 222.8C40.6 228.5 32 241.5 32 256s8.6 27.5 21.9 33.2l209.3 89.7c7.8 3.4 16.3 5.1 24.8 5.1s17-1.7 24.8-5.1l209.3-89.7c13.3-5.7 21.9-18.8 21.9-33.2s-8.6-27.5-21.9-33.2l-31.2-13.4L430 235.5 477.7 256 293.9 334.8c-1.9 .8-3.9 1.2-5.9 1.2s-4-.4-5.9-1.2L98.3 256 146 235.5 85.1 209.4 53.9 222.8zm0 128C40.6 356.5 32 369.5 32 384s8.6 27.5 21.9 33.2l209.3 89.7c7.8 3.4 16.3 5.1 24.8 5.1s17-1.7 24.8-5.1l209.3-89.7c13.3-5.7 21.9-18.8 21.9-33.2s-8.6-27.5-21.9-33.2l-31.2-13.4L430 363.5 477.7 384 293.9 462.8c-1.9 .8-3.9 1.2-5.9 1.2s-4-.4-5.9-1.2L98.3 384 146 363.5 85.1 337.4 53.9 350.8z"
      />
    </svg>
  );
}

/** Three adjustable sliders — used for the Controls nav button. */
export function SlidersIcon(props: TSvgProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M2 4h12M2 8h12M2 12h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="5" cy="4" r="1.75" fill="currentColor" />
      <circle cx="11" cy="8" r="1.75" fill="currentColor" />
      <circle cx="7" cy="12" r="1.75" fill="currentColor" />
    </svg>
  );
}

/** Chevron pointing left — used to collapse the nav pill. */
export function ChevronLeftIcon(props: TSvgProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M10 3L5 8L10 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Chevron pointing right — used to expand the nav pill. */
export function ChevronRightIcon(props: TSvgProps) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M5.5 3L10.5 8L5.5 13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
