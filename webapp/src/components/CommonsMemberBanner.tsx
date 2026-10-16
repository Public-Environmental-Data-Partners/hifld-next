import { useState } from "react";
import { COMMONS_FUNDERS, COMMONS_MEMBERS, COMMONS_PARTNERS, type CommonsMember } from "@/lib/commons-members";

interface CommonsMemberBannerProps {
  /** "page" = larger logos for standalone pages (e.g. Commons); default = compact for inline use */
  size?: "default" | "page";
}

export function CommonsMemberBanner({ size = "default" }: CommonsMemberBannerProps) {
  return (
    <div className="space-y-12">
      {[
        { title: "Stewards", members: COMMONS_MEMBERS },
        { title: "Partners", members: COMMONS_PARTNERS },
        { title: "Funders", members: COMMONS_FUNDERS },
      ].map((group) => (
        <section key={group.title}>
          <h2 className="text-center text-lg font-semibold tracking-tight text-foreground">{group.title}</h2>
          <div className="mx-auto mt-6 flex max-w-xl flex-wrap items-start justify-center gap-x-6 gap-y-8 sm:gap-x-12">
            {group.members.map((member) => (
              <MemberLogo key={member.name} member={member} bannerSize={size} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function MemberLogo({ member, bannerSize }: { member: CommonsMember; bannerSize: "default" | "page" }) {
  const [imgError, setImgError] = useState(false);

  const imgClass =
    bannerSize === "page"
      ? "h-20 w-full max-w-[160px] sm:h-24 sm:max-w-[220px]"
      : member.logoSize === "lg"
        ? "h-16 w-full max-w-[140px] sm:h-20 sm:max-w-[180px]"
        : "size-8 sm:size-10";

  return (
    <a
      href={member.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex w-36 flex-col items-center gap-2 transition-opacity hover:opacity-80 sm:w-52"
      title={member.name}
    >
      {!imgError && (
        <img
          src={member.logo}
          alt=""
          className={`shrink-0 object-contain object-center ${imgClass}`}
          onError={() => setImgError(true)}
        />
      )}
      <span className="text-center text-xs text-muted-foreground">{member.name}</span>
    </a>
  );
}
