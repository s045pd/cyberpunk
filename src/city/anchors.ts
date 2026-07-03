/** 地标锚点（世界坐标）与楼群净空半径 */
export interface LandmarkAnchor {
  id: string;
  x: number;
  z: number;
  r: number; // 净空半径（米）
}

export const LANDMARK_ANCHORS: LandmarkAnchor[] = [
  { id: 'arasaka', x: -760, z: -240, r: 300 },        // 市中心 荒坂塔
  { id: 'corpo-twins', x: -1300, z: 240, r: 200 },    // 市中心 双塔
  { id: 'megabuilding-h10', x: 0, z: -2400, r: 240 }, // Watson H10
  { id: 'kabuki-dome', x: 960, z: -2800, r: 170 },    // Watson Kabuki 市场穹顶
  { id: 'konpeki', x: 400, z: -640, r: 150 },         // 市中心边缘 Konpeki
  { id: 'pacifica-ruin', x: -800, z: 2000, r: 230 },  // Pacifica 烂尾大酒店
];

export const LANDMARK_CLEARINGS = LANDMARK_ANCHORS.map(({ x, z, r }) => ({ x, z, r }));
