import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { MainMenuChildNav } from './MainMenuChildNav';
import { MainMenuHeader } from './MainMenuHeader';
import { MainMenuOverlay } from './MainMenuOverlay';

function findElementByType(tree: React.ReactNode, type: React.ElementType): React.ReactElement | null {
  if (!React.isValidElement(tree)) return null;
  if (tree.type === type) return tree;

  for (const child of React.Children.toArray(tree.props.children)) {
    const match = findElementByType(child, type);
    if (match) return match;
  }

  return null;
}

function collectText(tree: React.ReactNode): string[] {
  if (typeof tree === 'string' || typeof tree === 'number') return [String(tree)];
  if (!React.isValidElement(tree)) return [];

  return React.Children.toArray(tree.props.children).flatMap(collectText);
}

test('MainMenuOverlay nests child navigation inside the header nav cluster', () => {
  const element = MainMenuOverlay({
    isVisible: true,
    showAdminDashboard: false,
    adminDashboard: {
      account: null,
    } as React.ComponentProps<typeof MainMenuOverlay>['adminDashboard'],
    header: {
      appVersion: '0.0.0',
      deviceInfo: { isMobile: false, os: 'unknown' },
      activeParent: 'play',
      isOnline: true,
      onlineCount: 1,
      onSelectParent: () => {},
    },
    childNav: {
      parent: 'play',
      playChild: 'single',
      customizationChild: 'armory',
      isAdmin: false,
      onSelectPlayChild: () => {},
      onSelectCustomizationChild: () => {},
      onOpenAdminDashboard: () => {},
    },
    primaryPanel: {} as React.ComponentProps<typeof MainMenuOverlay>['primaryPanel'],
    broadcastRail: {} as React.ComponentProps<typeof MainMenuOverlay>['broadcastRail'],
  });

  const header = findElementByType(element, MainMenuHeader);
  assert.ok(header);
  assert.ok(React.isValidElement(header.props.childNav));
  assert.equal(header.props.childNav.type, MainMenuChildNav);
});

test('MainMenuChildNav does not render the removed customization identity tab', () => {
  const element = MainMenuChildNav({
    parent: 'customization',
    playChild: 'single',
    customizationChild: 'armory',
    isAdmin: false,
    onSelectPlayChild: () => {},
    onSelectCustomizationChild: () => {},
    onOpenAdminDashboard: () => {},
  });

  const labels = collectText(element);

  assert.equal(labels.includes('Armory'), true);
  assert.equal(labels.includes('Hotkeys'), true);
  assert.equal(labels.includes('Gamepad'), true);
  assert.equal(labels.includes('Identity'), false);
});
