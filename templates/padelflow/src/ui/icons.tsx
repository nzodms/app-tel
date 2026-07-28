/** Hand-drawn stroke icons. No icon library — previews have no npm install. */

interface IconProps {
  size?: number;
  strokeWidth?: number;
}

function Svg({ size = 20, strokeWidth = 1.6, children }: IconProps & { children: unknown }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function ChevronLeft(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={2}>
      <path d="M15 5l-7 7 7 7" />
    </Svg>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 5l7 7-7 7" />
    </Svg>
  );
}

export function Check(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={2.4}>
      <path d="M4.5 12.5l5 5 10-11" />
    </Svg>
  );
}

export function Court(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 12h18M12 4v16" />
    </Svg>
  );
}

export function Calendar(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3.5v3M16 3.5v3" />
    </Svg>
  );
}

export function Inbox(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 13.5V7a2.5 2.5 0 012.5-2.5h12A2.5 2.5 0 0120.5 7v6.5" />
      <path d="M3.5 13.5h4l1.5 3h6l1.5-3h4v3.5a2.5 2.5 0 01-2.5 2.5H6a2.5 2.5 0 01-2.5-2.5z" />
    </Svg>
  );
}

export function Users(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
      <path d="M16 6.2a3.2 3.2 0 010 6M17.5 19.5c0-2.2-.9-3.7-2.2-4.6" />
    </Svg>
  );
}

export function Alert(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5M12 15.8v.2" />
    </Svg>
  );
}

export function Pin(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 21s6.5-6.1 6.5-10.5A6.5 6.5 0 005.5 10.5C5.5 14.9 12 21 12 21z" />
      <circle cx="12" cy="10.3" r="2.3" />
    </Svg>
  );
}

export function Star(props: IconProps) {
  return (
    <Svg {...props} strokeWidth={1.4}>
      <path d="M12 4l2.3 4.9 5.2.7-3.8 3.7.9 5.3-4.6-2.5-4.6 2.5.9-5.3L4.5 9.6l5.2-.7z" />
    </Svg>
  );
}

export function Clock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function WifiOff(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3 5l18 14" />
      <path d="M5 12.5a9.5 9.5 0 013.5-2.3M9 16a5 5 0 015-.6" />
      <path d="M12 20h.01" />
    </Svg>
  );
}
