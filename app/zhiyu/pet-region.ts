type Position = [number, number];
type Ring = Position[];
type GeoFeature = {
  properties: { adcode: number; name: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] };
};
type ProvinceData = { type: 'FeatureCollection'; features: GeoFeature[] };

function insideRing(longitude: number, latitude: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > latitude) !== (yj > latitude) &&
      longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insidePolygon(longitude: number, latitude: number, rings: Ring[]): boolean {
  return rings.length > 0 && insideRing(longitude, latitude, rings[0]) &&
    !rings.slice(1).some(ring => insideRing(longitude, latitude, ring));
}

function shortProvinceName(name: string): string {
  return name.replace(/(壮族自治区|回族自治区|维吾尔自治区|特别行政区|自治区|省|市)$/, '');
}

export function provinceFromPoint(data: ProvinceData, latitude: number, longitude: number): { code: number; name: string } | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  for (const feature of data.features) {
    const polygons = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as Ring[]]
      : feature.geometry.coordinates as Ring[][];
    if (polygons.some(polygon => insidePolygon(longitude, latitude, polygon))) {
      return { code: feature.properties.adcode, name: shortProvinceName(feature.properties.name) };
    }
  }
  return null;
}

export async function provinceForCoordinates(latitude: number, longitude: number): Promise<{ code: number; name: string } | null> {
  const response = await fetch('/pets/geo/china-provinces.geojson');
  if (!response.ok) throw new Error('地区资料暂时无法加载，请稍后重试。');
  return provinceFromPoint(await response.json() as ProvinceData, latitude, longitude);
}
