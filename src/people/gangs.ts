import { DistrictId, DISTRICTS, districtAt, CITY_SIZE } from '../city/districts';
import { createRng, range, rangeInt } from '../core/rng';
import { coastXAt } from '../city/water';

export type GangId = 'ferro' | 'oni' | 'tide' | 'aurel';

export interface Gang {
  id: GangId;
  name: string;
  color: number;
  district: DistrictId;
}

// 原创虚构帮派（色标 = 巡逻队衣着与地盘晕染色）
export const GANGS: Gang[] = [
  { id: 'ferro', name: '铁蛆 FERRO', color: 0xff5a1a, district: 'santo-domingo' },
  { id: 'oni', name: '鬼刃 ONI', color: 0xff2975, district: 'westbrook' },
  { id: 'tide', name: '浪潮 TIDE', color: 0x00d5c8, district: 'pacifica' },
  { id: 'aurel', name: '金环 AUREL', color: 0xe8b53a, district: 'heywood' },
];

export function gangById(id: GangId): Gang {
  return GANGS.find((g) => g.id === id)!;
}

export interface SquadSpawn {
  gangId: GangId;
  x: number;
  z: number;
  members: number;
}

const SQUADS_PER_GANG = 6;

/** 纯逻辑、可单测：在各帮地盘内撒巡逻小队出生点 */
export function planSquads(seed: number): SquadSpawn[] {
  const rng = createRng((seed ^ 0x9a4d) >>> 0);
  const out: SquadSpawn[] = [];
  for (const gang of GANGS) {
    const poly = DISTRICTS.find((d) => d.id === gang.district)!.polygon;
    let minX = 1; let minY = 1; let maxX = 0; let maxY = 0;
    for (const [px, py] of poly) {
      minX = Math.min(minX, px); maxX = Math.max(maxX, px);
      minY = Math.min(minY, py); maxY = Math.max(maxY, py);
    }
    let placed = 0;
    let guard = 0;
    while (placed < SQUADS_PER_GANG && guard++ < 4000) {
      const x = (range(rng, minX, maxX) - 0.5) * CITY_SIZE;
      const z = (range(rng, minY, maxY) - 0.5) * CITY_SIZE;
      if (districtAt(x, z)?.id !== gang.district) continue;
      if (x < coastXAt(z) + 80) continue;
      out.push({ gangId: gang.id, x, z, members: rangeInt(rng, 3, 5) });
      placed++;
    }
  }
  return out;
}
