import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { cn } from "@/lib/utils";

const SAFE_LINK_PROTOCOLS = new Set(["https:", "mailto:"]);

function safeMarkdownLinkUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? trimmed : "";
  } catch {
    return "";
  }
}

function safeMarkdownImageUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" ? trimmed : "";
  } catch {
    return "";
  }
}

const markdownComponents: Components = {
  a: ({ href, children }) => {
    const safeHref = href ? safeMarkdownLinkUrl(href) : "";
    if (!safeHref) return <span>{children}</span>;
    return (
      <a href={safeHref} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safeSrc = src ? safeMarkdownImageUrl(src) : "";
    if (!safeSrc) return null;
    return (
      <img
        src={safeSrc}
        alt={alt ?? ""}
        className="mt-2 max-h-10 max-w-full object-contain sm:max-w-40"
        loading="lazy"
      />
    );
  },
  p: ({ children }) => <p className="min-w-0 break-words">{children}</p>,
};

interface MarkdownDescriptionProps {
  markdown: string;
  className?: string | undefined;
}

export function MarkdownDescription({ markdown, className }: MarkdownDescriptionProps) {
  return (
    <div className={cn("min-w-0 max-w-full space-y-1 overflow-hidden text-muted-foreground", className)}>
      <ReactMarkdown
        rehypePlugins={[rehypeSanitize]}
        components={markdownComponents}
        urlTransform={safeMarkdownLinkUrl}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
