import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Database, Home, Info, Menu, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const PEDP_LOGO =
  "https://images.squarespace-cdn.com/content/v1/6793060d1570ff20aceb1125/807a2f81-c6a3-4a9b-adbc-86a84a81fa7e/pedp_mark_pad.png?format=1500w";

export default function Header() {
  const [open, setOpen] = useState(false);

  const navLinks = (
    <>
      <Link
        to="/"
        className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        activeProps={{ className: "px-3 py-2 text-sm font-bold text-foreground" }}
        activeOptions={{ exact: true }}
      >
        Home
      </Link>
      <Link
        to="/collections"
        className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        activeProps={{ className: "px-3 py-2 text-sm font-bold text-foreground" }}
      >
        Collections
      </Link>
      <Link
        to="/commons"
        className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        activeProps={{ className: "px-3 py-2 text-sm font-bold text-foreground" }}
      >
        Commons
      </Link>
      <Link
        to="/about"
        className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        activeProps={{ className: "px-3 py-2 text-sm font-bold text-foreground" }}
      >
        About
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-50 w-full border-b-2 bg-background">
      <div className="flex h-14 items-center justify-between px-4 gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-64">
              <SheetHeader>
                <SheetTitle>Navigation</SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-2 mt-4">
                <Link
                  to="/"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  <Home className="h-4 w-4" />
                  Home
                </Link>
                <Link
                  to="/collections"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  <Database className="h-4 w-4" />
                  Collections
                </Link>
                <Link
                  to="/commons"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  <Users className="h-4 w-4" />
                  Commons
                </Link>
                <Link
                  to="/about"
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-accent"
                >
                  <Info className="h-4 w-4" />
                  About
                </Link>
              </nav>
            </SheetContent>
          </Sheet>

          <Link to="/" className="flex items-center gap-2 min-w-0">
            <img
              src={PEDP_LOGO}
              alt="Public Environmental Data Partners"
              className="h-8 w-auto object-contain"
            />
            <span className="font-bold text-base sm:text-lg tracking-tight truncate">
              HIFLD Next
            </span>
          </Link>
        </div>

        <nav className="hidden md:flex items-center gap-1" aria-label="Main">
          {navLinks}
        </nav>
      </div>
    </header>
  );
}
