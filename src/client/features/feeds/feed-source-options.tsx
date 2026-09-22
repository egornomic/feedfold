import { Rss, Send, SquarePlay } from "lucide-react";
import type { SVGProps } from "react";

function XLogo({ size = 16, ...props }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg {...props} width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <title>X</title>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export const ADD_FEED_SOURCE_OPTIONS = [
  {
    value: "rss",
    label: "Website or feed",
    description: "Follow updates from a website or a direct feed address.",
    detail: "RSS, Atom, or JSON Feed",
    recommended: true,
    icon: Rss,
  },
  {
    value: "youtube",
    label: "YouTube channel",
    description: "Follow new videos from a YouTube channel.",
    detail: "Channel videos",
    recommended: false,
    icon: SquarePlay,
  },
  {
    value: "telegram",
    label: "Telegram channel",
    description: "Follow posts from a public Telegram channel.",
    detail: "Public channels only",
    recommended: false,
    icon: Send,
  },
  {
    value: "x",
    label: "X profile",
    description: "Follow a public X profile through Nitter RSS.",
    detail: "Public profiles only",
    recommended: false,
    icon: XLogo,
  },
] as const;
