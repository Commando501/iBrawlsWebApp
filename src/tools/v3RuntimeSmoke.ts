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

export interface V3RuntimeSmokeObservation {
  itemId: string;
  viewport: V3RuntimeSmokeViewport['id'];
  title: string;
  visibleText: string;
  rootChildCount?: number;
  canvasCount?: number;
  horizontalOverflow: boolean;
  performanceReady?: boolean;
}

export interface V3RuntimeSmokeReport {
  ready: boolean;
  missingObservations: string[];
  failedObservations: string[];
  observations: V3RuntimeSmokeObservation[];
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
      expectedText: ['Customization', 'V1', 'V2'],
      viewports: ['desktop', 'mobile'],
    },
    {
      id: 'armor-editor-v3-validation',
      path: '/armor-model-editor.html',
      expectedText: [
        'V3',
        'Validation',
        'Budget',
        'Save Copy',
        'Motion QA',
        'Check Active Pose',
        'Hammer Strike',
        'Motion Fixes',
        'Apply Motion Fix',
        'Clear Limb Overlap',
        'Publish Check',
        'Review Suit',
        'Review Profile',
        'Jump to Issue',
      ],
      viewports: ['desktop', 'mobile'],
    },
    {
      id: 'asset-preview-local-tooling',
      path: '/v3-asset-preview.html',
      expectedText: ['V3 Asset Preview', 'Render Synthetic Preview'],
      viewports: ['desktop'],
    },
    {
      id: 'readiness-dashboard-local-tooling',
      path: '/v3-readiness-dashboard.html',
      expectedText: [
        'V3 Readiness Dashboard',
        'Not Player Ready',
        'Manual Readiness Checklist',
        'Reference File',
        'OBJ Canonical Reference',
        'Proportion Bands',
        'Choose Local Reference File',
        'Download Readiness Report',
        'Baseline Gaps',
        'Download Baseline Markdown',
        'Copy Baseline Markdown',
        'Calibration Candidates',
        'Download Calibration Report',
        'Copy Calibration Report',
        'Download Calibration JSON',
        'Copy Calibration JSON',
        'Rendered Gate Closure',
        'Reconstruction Required',
        'Reference Feature Match',
      ],
      viewports: ['desktop'],
    },
    {
      id: 'performance-smoke-mobile-low',
      path: '/v3-performance-smoke.html?tier=mobileLow',
      expectedText: ['Phase 26 Ready', 'mobileLow', 'visual pass', 'motion pass', 'models 8'],
      viewports: ['mobile'],
    },
    {
      id: 'performance-smoke-desktop',
      path: '/v3-performance-smoke.html?tier=desktop',
      expectedText: ['Phase 26 Ready', 'desktop', 'visual pass', 'motion pass', 'models 8'],
      viewports: ['desktop'],
    },
  ];
}

export function buildV3RuntimeSmokeReport(
  observations: readonly V3RuntimeSmokeObservation[],
  checklist: readonly V3RuntimeSmokeChecklistItem[] = buildV3RuntimeSmokeChecklist()
): V3RuntimeSmokeReport {
  const byKey = new Map(observations.map((entry) => [`${entry.itemId}:${entry.viewport}`, entry]));
  const missingObservations: string[] = [];
  const failedObservations: string[] = [];

  for (const item of checklist) {
    for (const viewport of item.viewports) {
      const key = `${item.id}:${viewport}`;
      const observation = byKey.get(key);
      if (!observation) {
        missingObservations.push(key);
        continue;
      }

      const hasRenderedContent =
        observation.visibleText.trim().length > 0 ||
        (observation.rootChildCount ?? 0) > 0 ||
        (observation.canvasCount ?? 0) > 0;
      if (!hasRenderedContent) {
        failedObservations.push(`${key}: blank`);
      }

      for (const expectedText of item.expectedText) {
        const normalizedExpected = expectedText.toLocaleLowerCase();
        const normalizedVisibleText = observation.visibleText.toLocaleLowerCase();
        const normalizedTitle = observation.title.toLocaleLowerCase();
        const found =
          normalizedVisibleText.includes(normalizedExpected) ||
          normalizedTitle.includes(normalizedExpected);
        if (!found) {
          failedObservations.push(`${key}: missing expected text "${expectedText}"`);
        }
      }

      if (observation.horizontalOverflow) {
        failedObservations.push(`${key}: horizontal overflow`);
      }

      if (item.path.startsWith('/v3-performance-smoke.html') && observation.performanceReady !== true) {
        failedObservations.push(`${key}: performance smoke not ready`);
      }
    }
  }

  return {
    ready: missingObservations.length === 0 && failedObservations.length === 0,
    missingObservations,
    failedObservations,
    observations: [...observations],
  };
}
