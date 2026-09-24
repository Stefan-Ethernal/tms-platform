import type { LoadingPointKind } from '@tms/contracts';

export const SEED_PRODUCTS: readonly { code: string; name: string }[] = [
  { code: 'DIESEL', name: 'Diesel' },
  { code: 'GASOLINE_95', name: 'Gasoline 95' },
  { code: 'GASOLINE_98', name: 'Gasoline 98' },
  { code: 'JET_A1', name: 'Jet A-1' },
  { code: 'HEATING_OIL', name: 'Heating oil' },
];

export type SeedLoadingPointKind = LoadingPointKind;

export const SEED_LOADING_POINTS: readonly {
  code: string;
  name: string;
  kind: SeedLoadingPointKind;
}[] = [
  { code: 'ISLAND-01', name: 'Island 1', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-02', name: 'Island 2', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-03', name: 'Island 3', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-04', name: 'Island 4', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-05', name: 'Island 5', kind: 'TRUCK_ISLAND' },
  { code: 'ISLAND-06', name: 'Island 6', kind: 'TRUCK_ISLAND' },
  { code: 'TRACK-01', name: 'Rail track 1', kind: 'RAIL_TRACK' },
  { code: 'TRACK-02', name: 'Rail track 2', kind: 'RAIL_TRACK' },
];
