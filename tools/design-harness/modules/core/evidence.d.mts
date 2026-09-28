import type { Page, Locator } from 'playwright';
export function writeEvidence(page: Page, options: {
  basePath: string;
  observation?: object & { missing: string[] };
  identity: { target: string; state: string; viewport: string };
  sourceRoot?: string;
  details?: unknown;
  issues?: { type: string; message: string }[];
  screenshot?: boolean;
  crop?: string | Locator;
}): Promise<{ status: string; png: string | null; artifacts: { png: string | null }; missing: string[]; errors: string[] }>;
