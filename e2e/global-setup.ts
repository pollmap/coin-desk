import type { FullConfig } from '@playwright/test';

export default async function setup(config: FullConfig) {
  const baseURL = config.projects[0].use.baseURL!;
  const response = await fetch(baseURL);
  const html = await response.text();
  if (!response.ok || !html.includes('id="root"'))
    throw new Error(
      `Fixture frontend is unavailable: HTTP ${response.status}. Check Vite root/serving rules before running browser flows.`,
    );
}
