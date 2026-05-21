/**
 * HIFLD Next Commons founding members / stewards.
 * PEDP uses Squarespace logo; others use Google favicon so all four display reliably.
 */
function favicon(domain: string, size = 64) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;
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
    logo: favicon("datarescueproject.org"),
    logoSize: "default",
  },
  {
    name: "Niyam IT",
    url: "https://niyamit.com/",
    logo: favicon("niyamit.com"),
    logoSize: "default",
  },
] as const;
