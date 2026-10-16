/** HIFLD Next Commons stewards, partners, and funders. */
export interface CommonsMember {
  name: string;
  url: string;
  logo: string;
  logoSize: "default" | "lg";
}

export const COMMONS_MEMBERS = [
  {
    name: "Fulton Ring",
    url: "https://www.fultonring.com/",
    logo: "/commons/fulton-ring-logo.svg",
    logoSize: "lg",
  },
  {
    name: "Public Environmental Data Partners",
    url: "https://screening-tools.com/",
    logoSize: "default",
    logo: "https://images.squarespace-cdn.com/content/v1/6793060d1570ff20aceb1125/807a2f81-c6a3-4a9b-adbc-86a84a81fa7e/pedp_mark_pad.png?format=300w",
  },
  {
    name: "Data Rescue Project",
    url: "https://www.datarescueproject.org/",
    logo: "/commons/data-rescue-project-logo.png",
    logoSize: "lg",
  },
  {
    name: "Niyam IT",
    url: "https://niyamit.com/",
    logo: "/commons/niyam-it-logo.svg",
    logoSize: "lg",
  },
] as const;

export const COMMONS_PARTNERS = [
  {
    name: "Digital Public Goods Network",
    url: "https://dpgn.org/",
    logo: "/commons/dpgn-logo.png",
    logoSize: "lg",
  },
] as const;

export const COMMONS_FUNDERS = [
  {
    name: "MacArthur Foundation",
    url: "https://www.macfound.org/",
    logo: "/commons/macarthur-foundation-logo.png",
    logoSize: "lg",
  },
  {
    name: "Open Environmental Data Project",
    url: "https://www.openenvironmentaldata.org/",
    logo: "/commons/oedp-logo.webp",
    logoSize: "lg",
  },
] as const;
