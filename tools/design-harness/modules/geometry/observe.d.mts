import type { Page } from 'playwright';
export type Rect = { x: number; y: number; left: number; top: number; right: number; bottom: number; width: number; height: number };
export type RegionSpec = { id: string; selector: string; optional?: boolean; allowHidden?: boolean; textBounds?: boolean; styles?: string[]; typography?: boolean; role?: string };
export type Relation = { id: string; from: string; to: string; metric: 'vertical-gap' | 'horizontal-gap' | 'left-delta' | 'width-ratio'; range?: number[] };
export type Scope = { id: string; root: string; regions: RegionSpec[]; relationships?: Relation[] };
export type Observation = {
  scopeId: string; root: string; rootRect: Rect | null; observedAt: string;
  coordinateSystem: 'viewport'; missing: string[];
  regions: (RegionSpec & { exists: boolean; count: number; visible: boolean; rect: Rect | null; textRect: Rect | null; style: Record<string, string> | null })[];
  relationships: (Relation & { value: number | null; status: string })[];
  diagnostics: { url: string; scroll: { x: number; y: number }; page: { width: number; height: number }; horizontalOverflow: number };
};
export function measurePage(page: Page, scope: Scope): Promise<Observation>;
