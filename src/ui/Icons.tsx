import type { ReactNode, SVGProps } from "react";

type IconName =
  | "paw" | "heart" | "bowl" | "drop" | "bolt" | "sparkle"
  | "whistle" | "comb" | "settings" | "volume" | "mute"
  | "chevron" | "close" | "back" | "cloud" | "moon" | "check";

type Props = SVGProps<SVGSVGElement> & { name: IconName; size?: number };

export function Icon({ name, size = 22, ...props }: Props) {
  const paths: Record<IconName, ReactNode> = {
    paw: <><circle cx="6.5" cy="7" r="1.3"/><circle cx="11" cy="5.5" r="1.3"/><circle cx="15.5" cy="7" r="1.3"/><circle cx="19" cy="10.5" r="1.2"/><path d="M7 15c1.4-2.7 3-4.2 5-4.2s3.6 1.5 5 4.2c1.7 3.5-1 5.5-3.5 4.4-1-.5-2-.5-3 0C8 20.5 5.3 18.5 7 15Z"/></>,
    heart: <path d="M20.8 8.5c0 5-8.8 10.5-8.8 10.5S3.2 13.5 3.2 8.5a4.6 4.6 0 0 1 8.8-1.8 4.6 4.6 0 0 1 8.8 1.8Z"/>,
    bowl: <><path d="M3.5 12.5h17l-2 6a2 2 0 0 1-1.9 1.3H7.4a2 2 0 0 1-1.9-1.3l-2-6Z"/><path d="M2.5 12.5h19M7 9c0-2.7 1.5-4 4-4.5M13 9c.3-2 1.8-3.5 4-4"/></>,
    drop: <path d="M12 2.5S5.5 10 5.5 14.2a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5Z"/>,
    bolt: <path d="m13.6 2.5-8.7 11H12l-1.6 8 8.7-11H12z"/>,
    sparkle: <><path d="M12 2.5 14.4 9.6 21.5 12l-7.1 2.4-2.4 7.1-2.4-7.1L2.5 12l7.1-2.4L12 2.5Z"/></>,
    whistle: <><circle cx="10" cy="13.5" r="5.5"/><circle cx="10" cy="13.5" r="2"/><path d="M13 8.9 18.5 5l2 3-5.2 4M4 5l1.7 1.7M10 2.5v2"/></>,
    comb: <><path d="M4 6.5h16v4.6H4zM6 11.1V21M9 11.1V18M12 11.1V21M15 11.1V18M18 11.1V21"/></>,
    settings: <><path d="M10 3h4l.6 2.1 1.9.9 2-.9 2.7 2.9-1.1 1.9.5 2.1 1.7 1v3.5l-2.1.6-.8 1.8.9 2-2.8 2.6-2-.9-2 .6-.9 1.8h-3.5l-.6-2.1-1.8-.8-2 .9-2.7-2.7.9-2-.6-2L2 14v-3.5l2.1-.6.8-1.8-.9-2L6.8 3.5l2 .9L10 3Z" transform="translate(0 -1.2) scale(1 .95)"/><circle cx="12" cy="12" r="3"/></>,
    volume: <><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6a8 8 0 0 1 0 12"/></>,
    mute: <><path d="M4 9v6h4l5 4V5L8 9H4Z"/><path d="m17 9 5 6m0-6-5 6"/></>,
    chevron: <path d="m6 9 6 6 6-6"/>,
    close: <path d="M5 5 19 19M19 5 5 19"/>,
    back: <path d="m13 5-7 7 7 7M7 12h14"/>,
    cloud: <><path d="M6.5 18h11a4.2 4.2 0 0 0 .7-8.3 6.5 6.5 0 0 0-12.7 1.6A3.4 3.4 0 0 0 6.5 18Z"/></>,
    moon: <path d="M19.5 16.7A8.5 8.5 0 0 1 7.3 4.5 8.5 8.5 0 1 0 19.5 16.7Z"/>,
    check: <path d="m5 12 4.5 4.5L19 7"/>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
