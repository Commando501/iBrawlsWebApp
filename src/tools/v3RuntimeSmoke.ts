export interface V3RuntimeSmokeViewport {
  id: 'desktop' | 'mobile';
  width: number;
  height: number;
}

export interface V3RuntimeSmokeChecklistItem {
  id: string;
  path: string;
  expectedText: readonly string[];
  viewports: readonly V3RuntimeSmokeViewport['id'][];
}

export const V3_RUNTIME_SMOKE_VIEWPORTS: readonly V3RuntimeSmokeViewport[] = [
  { id: 'desktop', width: 1280, height: 800 },
  { id: 'mobile', width: 390, height: 844 },
];

export function buildV3RuntimeSmokeChecklist(): V3RuntimeSmokeChecklistItem[] {
  return [
    {
      id: 'main-menu-model-policy',
      path: '/',
      expectedText: ['Customization', 'V1', 'V2', 'V3'],
      viewports: ['desktop', 'mobile'],
    },
    {
      id: 'armor-editor-v3-validation',
      path: '/armor-model-editor.html',
      expectedText: ['V3', 'Validation', 'Budget', 'Save Copy'],
      viewports: ['desktop', 'mobile'],
    },
    {
      id: 'asset-preview-local-tooling',
      path: '/v3-asset-preview.html',
      expectedText: ['V3 Asset Preview', 'Render Synthetic Preview'],
      viewports: ['desktop'],
    },
    {
      id: 'performance-smoke-mobile-low',
      path: '/v3-performance-smoke.html?tier=mobileLow',
      expectedText: ['Phase 13 Ready', 'mobileLow', 'models 8'],
      viewports: ['mobile'],
    },
    {
      id: 'performance-smoke-desktop',
      path: '/v3-performance-smoke.html?tier=desktop',
      expectedText: ['Phase 13 Ready', 'desktop', 'models 8'],
      viewports: ['desktop'],
    },
  ];
}
