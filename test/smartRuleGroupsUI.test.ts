import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import React from 'react';
import { act, create } from 'react-test-renderer';
import ts from 'typescript';
import { EMPTY_RULE, evaluateSmartRule, normalizeSmartRule, type SmartRule } from '../src/lib/smartRules';
const require = createRequire(import.meta.url);
test('the actual advanced rule editor adds, configures and removes groups without resetting existing basic filters', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const exports: Record<string, any> = {}, imports: Record<string, unknown> = {
    'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { Text: 'Text', View: 'View' },
    './glass': { GlassPressable: 'Button', GlassTextInput: 'Input' }, './SettingsUI': { SelectList: 'Select', SettingsGroup: 'Group', settingsStyles: {} },
    '@/i18n': { useT: () => (text: string, values?: Record<string, unknown>) => text.replace('{n}', String(values?.n ?? '')) },
    '@/theme': { useTheme() {}, themed: () => ({}), fontSize: {}, radius: {}, spacing: {} },
  };
  runInNewContext(ts.transpileModule(readFileSync(new URL('../src/components/SmartRuleGroups.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (name: string) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; } });
  let value: SmartRule = { ...EMPTY_RULE, id: 'rule', name: 'Rule', minRating: 4 };
  function Wrapper() { const [rule, set] = React.useState(value); return React.createElement(exports.SmartRuleGroups, { rule, onChange(groups: SmartRule['groups'], groupMatch: SmartRule['groupMatch']) { value = { ...rule, groups, groupMatch }; set(value); } }); }
  let view!: ReturnType<typeof create>; await act(async () => { view = create(React.createElement(Wrapper)); });
  const button = (label: string) => view.root.findAllByType('Button' as any).find((node) => node.findByType('Text' as any).props.children === label)!;
  await act(async () => { button('Add condition group').props.onPress(); });
  await act(async () => { view.root.findAllByType('Select' as any).find((node) => node.props.label === 'Condition 1')!.props.onChange('artist'); });
  await act(async () => { view.root.findByType('Input' as any).props.onChangeText('Eason'); });
  await act(async () => { view.root.findAllByType('Select' as any).find((node) => node.props.label === 'Between groups')!.props.onChange('any'); });
  assert.equal(value.minRating, 4); assert.equal(value.groupMatch, 'any'); assert.equal(normalizeSmartRule(value)?.groups?.[0].conditions[0].value, 'Eason');
  assert.deepEqual((await evaluateSmartRule([{ id: 'a', title: 'A', artist: 'Eason Chan', userRating: 5 }, { id: 'b', title: 'B', artist: 'Eason Chan', userRating: 2 }], value)).map((song) => song.id), ['a']);
  await act(async () => { button('Remove group').props.onPress(); }); assert.equal(value.groups?.length, 0); assert.equal(value.minRating, 4);
  await act(async () => { view.unmount(); });
});
