import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface PageLoaderProps {
  className?: string;
  /** Spinner size. Default: default (lg). */
  size?: "sm" | "default" | "lg";
}

const sizeClasses = {
  sm: "h-6 w-6",
  default: "h-8 w-8",
  lg: "h-10 w-10",
};

export function PageLoader({ className, size = "default" }: PageLoaderProps) {
  return (
    <div
      className={cn(
        "flex min-h-[200px] flex-col items-center justify-center gap-3 text-muted-foreground",
        className
      )}
      role="status"
      aria-label="Loading"
    >
      <Loader2
        className={cn("animate-spin", sizeClasses[size])}
        aria-hidden
      />
      <span className="text-sm">Loading…</span>
    </div>
  );
}
