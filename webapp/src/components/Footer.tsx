export default function Footer() {
  return (
    <footer className="border-t bg-background">
      <div className="mx-auto px-4 py-2">
        <div className="text-xs text-muted-foreground text-center space-y-1">
          <p>
            <a
              href="https://screening-tools.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              A Public Environmental Data Partners Website
            </a>
          </p>
          <p>
            Made by{" "}
            <a
              href="https://fultonring.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors"
            >
              Fulton Ring
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

