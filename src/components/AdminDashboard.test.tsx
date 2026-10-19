import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AdminDashboard from './AdminDashboard';

test('admin model toggle defaults off and edits the boolean publish draft', () => {
  let changed: unknown[] = [];
  const props: React.ComponentProps<typeof AdminDashboard> = {
    account: { username: 'Admin' } as any,
    settings: {},
    onSettingChange: (...args) => { changed = args; },
    aiSections: [], mechanicsContent: null, multiplayerPreset: null,
    onPublish: () => {}, isPublishing: false, publishStatus: null,
    botConfig: { enabled: false, count: 2, difficulty: 50 },
    onBotConfigChange: () => {}, onClose: () => {},
  };
  const findToggle = (node: React.ReactNode): React.ReactElement<any> | undefined => {
    if (!React.isValidElement<any>(node)) return undefined;
    if (node.type === 'input' && node.props.type === 'checkbox') return node;
    return React.Children.toArray(node.props.children).map(findToggle).find(Boolean);
  };
  const toggle = findToggle(AdminDashboard(props))!;
  assert.equal(toggle.props.checked, false);
  toggle.props.onChange({ target: { checked: true } });
  assert.deepEqual(changed, ['allowModelVariants', true]);
  const enabled = findToggle(AdminDashboard({ ...props, settings: { allowModelVariants: true } }))!;
  assert.equal(enabled.props.checked, true);
  enabled.props.onChange({ target: { checked: false } });
  assert.deepEqual(changed, ['allowModelVariants', false]);
  assert.match(renderToStaticMarkup(<AdminDashboard {...props} />), /Publish as Official Preset to apply this setting to everyone/);
});
