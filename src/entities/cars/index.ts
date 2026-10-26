import { buildCar, type CarDesign, type CarId, type CarModel } from '../carModel';
import { CYBERTRUCK } from './cybertruck';
import { MODEL_3 } from './model3';
import { MODEL_S } from './modelS';
import { MODEL_X } from './modelX';
import { MODEL_Y } from './modelY';
import { ROADSTER } from './roadster';
import { ROADSTER_PROTO } from './roadsterProto';

/** Every car in the garage, in the order the picker shows them. */
export const CARS: readonly CarDesign[] = [ROADSTER, ROADSTER_PROTO, MODEL_S, MODEL_3, MODEL_X, MODEL_Y, CYBERTRUCK];

export const DEFAULT_CAR: CarId = 'roadster';

export const isCarId = (id: unknown): id is CarId => CARS.some((c) => c.id === id);

export const carDesign = (id: CarId) => CARS.find((c) => c.id === id) ?? ROADSTER;

const built = new Map<CarId, CarModel>();

/** Builds a car the first time it is asked for; later calls reuse it. */
export function getCar(id: CarId): CarModel {
  let model = built.get(id);
  if (!model) built.set(id, (model = buildCar(carDesign(id))));
  return model;
}
