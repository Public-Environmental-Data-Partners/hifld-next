import { useState } from "react";
import { COMMONS_MEMBERS } from "@/lib/commons-members";

interface CommonsMemberBannerProps {
  /** "page" = larger logos for standalone pages (e.g. Commons); default = compact for inline use */
  size?: "default" | "page";
}

export function CommonsMemberBanner({ size = "default" }: CommonsMemberBannerProps) {
  return (
    <>
      {COMMONS_MEMBERS.map((member) => (
        <MemberLogo key={member.name} member={member} bannerSize={size} />
      ))}
    </>
  );
}

function MemberLogo({
  member,
  bannerSize,
}: {
  member: (typeof COMMONS_MEMBERS)[number];
  bannerSize: "default" | "page";
}) {
  const [imgError, setImgError] = useState(false);

  const imgClass =
    bannerSize === "page"
      ? "h-14 w-auto max-w-[160px] sm:h-20 sm:max-w-[220px]"
      : member.logoSize === "lg"
        ? "h-10 w-auto max-w-[140px] sm:h-12 sm:max-w-[180px]"
        : "size-8 sm:size-10";

  return (
    <a
      href={member.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center gap-2 transition-opacity hover:opacity-80"
      title={member.name}
    >
      {!imgError ? (
        <img
          src={member.logo}
          alt=""
          className={`shrink-0 object-contain object-center ${imgClass}`}
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="text-center text-xs font-medium text-muted-foreground sm:text-sm">
          {member.name}
        </span>
      )}
    </a>
  );
}
