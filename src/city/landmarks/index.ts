import * as THREE from 'three';
import { LANDMARK_ANCHORS } from '../anchors';
import { createArasakaTower } from './arasaka';
import { createMegabuilding } from './megabuilding';
import {
  createKonpeki, createKabukiDome, createPacificaRuin, createBadlandsProps,
} from './misc';

export function createLandmarks(seed: number): THREE.Group {
  const group = new THREE.Group();
  const byId = new Map(LANDMARK_ANCHORS.map((a) => [a.id, a]));

  const place = (id: string, obj: THREE.Group) => {
    const a = byId.get(id)!;
    obj.position.set(a.x, 0, a.z);
    group.add(obj);
  };

  place('arasaka', createArasakaTower());
  place('megabuilding-h10', createMegabuilding());
  place('konpeki', createKonpeki());
  place('kabuki-dome', createKabukiDome());
  place('pacifica-ruin', createPacificaRuin());

  // 双塔：复用荒坂体量缩放
  const twins = byId.get('corpo-twins')!;
  const twinA = createArasakaTower();
  twinA.scale.setScalar(0.55);
  twinA.position.set(twins.x - 90, 0, twins.z);
  const twinB = createArasakaTower();
  twinB.scale.setScalar(0.45);
  twinB.position.set(twins.x + 90, 0, twins.z + 40);
  group.add(twinA, twinB);

  group.add(createBadlandsProps(seed));
  return group;
}
