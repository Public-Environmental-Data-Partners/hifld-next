export interface MapCentroid {
  lat: number;
  lng: number;
}

export function googleMapsSearchUrl(centroid: MapCentroid): string {
  const url = new URL("https://www.google.com/maps/search/");
  url.searchParams.set("api", "1");
  url.searchParams.set("query", `${centroid.lat},${centroid.lng}`);
  return url.toString();
}
