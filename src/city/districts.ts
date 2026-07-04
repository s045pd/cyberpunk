export const CITY_SIZE = 8000;

export type DistrictId =
  | 'watson' | 'westbrook' | 'city-center'
  | 'heywood' | 'santo-domingo' | 'pacifica';

export interface DistrictStyle {
  label: string;
  heightRange: [number, number];
  heightBias: number;       // >1 偏矮，<1 偏高
  cellSize: number;         // 地块网格尺寸（米）
  density: number;          // 地块生成概率 0..1
  windowLitRate: number;    // 窗亮率 0..1
  facadeColor: number;      // 立面基色
  neonDensity: number;      // 霓虹密度 0..1
  neonPalette: number[];    // 霓虹色板
}

export interface District {
  id: DistrictId;
  style: DistrictStyle;
  polygon: Array<[number, number]>; // 归一化 [0,1]²，x→东，y→南
}

export const BADLANDS_LABEL = 'BADLANDS';

export const DISTRICTS: District[] = [
  {
    id: 'watson',
    style: {
      label: 'WATSON', heightRange: [40, 190], heightBias: 1.6, cellSize: 34,
      density: 0.97, windowLitRate: 0.34, facadeColor: 0x18202c,
      neonDensity: 1.0, neonPalette: [0xff2975, 0x00ffd5, 0xffe600, 0xff6a00],
    },
    polygon: [[0.28, 0.04], [0.66, 0.06], [0.68, 0.34], [0.44, 0.40], [0.28, 0.32]],
  },
  {
    id: 'westbrook',
    style: {
      label: 'WESTBROOK', heightRange: [60, 250], heightBias: 1.4, cellSize: 42,
      density: 0.94, windowLitRate: 0.38, facadeColor: 0x1b1826,
      neonDensity: 0.8, neonPalette: [0xff7ad9, 0xb96bff, 0x00e5ff],
    },
    polygon: [[0.66, 0.06], [0.94, 0.12], [0.92, 0.44], [0.68, 0.42], [0.68, 0.34]],
  },
  {
    id: 'city-center',
    style: {
      label: 'CITY CENTER', heightRange: [120, 450], heightBias: 2.0, cellSize: 64,
      density: 0.92, windowLitRate: 0.42, facadeColor: 0x101724,
      neonDensity: 0.5, neonPalette: [0x00e5ff, 0xffd24a, 0xff2975],
    },
    polygon: [[0.28, 0.32], [0.44, 0.40], [0.58, 0.44], [0.56, 0.62], [0.26, 0.58]],
  },
  {
    id: 'heywood',
    style: {
      label: 'HEYWOOD', heightRange: [30, 130], heightBias: 1.7, cellSize: 38,
      density: 0.96, windowLitRate: 0.3, facadeColor: 0x201c18,
      neonDensity: 0.35, neonPalette: [0xffd24a, 0xff6a00, 0x00ffd5],
    },
    polygon: [[0.58, 0.44], [0.68, 0.42], [0.72, 0.64], [0.56, 0.72], [0.56, 0.62]],
  },
  {
    id: 'santo-domingo',
    style: {
      label: 'SANTO DOMINGO', heightRange: [20, 95], heightBias: 1.8, cellSize: 62,
      density: 0.8, windowLitRate: 0.24, facadeColor: 0x241d14,
      neonDensity: 0.25, neonPalette: [0xff9e3d, 0xffd24a],
    },
    polygon: [[0.68, 0.42], [0.92, 0.44], [0.94, 0.86], [0.72, 0.84], [0.72, 0.64]],
  },
  {
    id: 'pacifica',
    style: {
      label: 'PACIFICA', heightRange: [15, 75], heightBias: 1.9, cellSize: 40,
      density: 0.72, windowLitRate: 0.1, facadeColor: 0x161a1a,
      neonDensity: 0.12, neonPalette: [0x00ffd5, 0xff2975],
    },
    polygon: [[0.26, 0.58], [0.56, 0.62], [0.56, 0.72], [0.50, 0.88], [0.24, 0.80]],
  },
];

export function pointInPolygon(
  x: number, y: number, poly: Array<[number, number]>,
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const crosses = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function normToWorld(nx: number, ny: number): [number, number] {
  return [(nx - 0.5) * CITY_SIZE, (ny - 0.5) * CITY_SIZE];
}

export function districtAt(wx: number, wz: number): District | null {
  const nx = wx / CITY_SIZE + 0.5;
  const ny = wz / CITY_SIZE + 0.5;
  for (const d of DISTRICTS) {
    if (pointInPolygon(nx, ny, d.polygon)) return d;
  }
  return null;
}
