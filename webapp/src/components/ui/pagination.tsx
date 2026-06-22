import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type PageItem = { type: "page"; page: number } | { type: "ellipsis"; position: "leading" | "trailing" };

export interface PaginationProps {
  total: number;
  limit: number;
  offset: number;
  onPageChange: (newOffset: number) => void;
  hrefForOffset?: (newOffset: number) => string;
  className?: string;
}

interface PaginationControlProps {
  ariaCurrent?: "page" | undefined;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean | undefined;
  href?: string | undefined;
  isActive?: boolean | undefined;
  onActivate: () => void;
}

function PaginationControl({
  ariaCurrent,
  ariaLabel,
  children,
  className,
  disabled,
  href,
  isActive,
  onActivate,
}: PaginationControlProps) {
  const buttonClassName = cn(className, isActive && "pointer-events-none");

  if (href && !disabled && !isActive) {
    return (
      <Button variant="outline" size="sm" asChild className={buttonClassName}>
        <a
          href={href}
          aria-label={ariaLabel}
          aria-current={ariaCurrent}
          onClick={(event) => {
            event.preventDefault();
            onActivate();
          }}
        >
          {children}
        </a>
      </Button>
    );
  }

  return (
    <Button
      variant={isActive ? "default" : "outline"}
      size="sm"
      onClick={onActivate}
      disabled={disabled}
      className={buttonClassName}
      aria-label={ariaLabel}
      aria-current={ariaCurrent}
    >
      {children}
    </Button>
  );
}

export function Pagination({ total, limit, offset, onPageChange, hrefForOffset, className }: PaginationProps) {
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);
  const startItem = offset + 1;
  const endItem = Math.min(offset + limit, total);

  const handlePrevious = () => {
    if (offset > 0) {
      onPageChange(Math.max(0, offset - limit));
    }
  };

  const handleNext = () => {
    if (offset + limit < total) {
      onPageChange(offset + limit);
    }
  };

  const handlePageClick = (page: number) => {
    const newOffset = (page - 1) * limit;
    onPageChange(newOffset);
  };

  if (totalPages <= 1) {
    return null;
  }

  const getPageItems = (): PageItem[] => {
    const pages: PageItem[] = [];
    const maxVisible = 7;

    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push({ type: "page", page: i });
      }
    } else {
      pages.push({ type: "page", page: 1 });

      if (currentPage > 3) {
        pages.push({ type: "ellipsis", position: "leading" });
      }

      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);

      for (let i = start; i <= end; i++) {
        pages.push({ type: "page", page: i });
      }

      if (currentPage < totalPages - 2) {
        pages.push({ type: "ellipsis", position: "trailing" });
      }

      pages.push({ type: "page", page: totalPages });
    }

    return pages;
  };

  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="text-sm text-muted-foreground">
        Showing {startItem} to {endItem} of {total} results
      </div>

      <div className="flex items-center gap-2">
        <PaginationControl
          ariaLabel="Previous page"
          disabled={offset === 0}
          href={hrefForOffset?.(Math.max(0, offset - limit))}
          onActivate={handlePrevious}
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </PaginationControl>

        <div className="flex items-center gap-1">
          {getPageItems().map((item) => {
            if (item.type === "ellipsis") {
              return (
                <span key={`ellipsis-${item.position}`} className="px-2 text-muted-foreground">
                  ...
                </span>
              );
            }

            const pageNum = item.page;
            const isActive = pageNum === currentPage;
            const pageOffset = (pageNum - 1) * limit;

            return (
              <PaginationControl
                key={pageNum}
                ariaLabel={`Go to page ${pageNum}`}
                ariaCurrent={isActive ? "page" : undefined}
                className="min-w-[2.5rem]"
                href={hrefForOffset?.(pageOffset)}
                isActive={isActive}
                onActivate={() => handlePageClick(pageNum)}
              >
                {pageNum}
              </PaginationControl>
            );
          })}
        </div>

        <PaginationControl
          ariaLabel="Next page"
          disabled={offset + limit >= total}
          href={hrefForOffset?.(offset + limit)}
          onActivate={handleNext}
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </PaginationControl>
      </div>
    </div>
  );
}
