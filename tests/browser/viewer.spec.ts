import { test, expect } from '@playwright/test';
test('navigate hierarchy, inspect class and source, select aggregate violation, persist proposals and isolate explicit context', async ({
  page,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (e) => failures.push(e.message));
  await page.goto('/');
  await expect(page.getByText('Project architecture')).toBeVisible();
  await expect(page.getByTestId('rf__node-Domain')).toBeVisible();
  await page.getByText('⚠ dependency', { exact: true }).click();
  await expect(page.locator('aside')).toContainText('RULE VIOLATION');
  await page.getByTestId('rf__node-Domain').click();
  await page.getByRole('button', { name: 'Explore component' }).click();
  await page.getByTestId('rf__node-Domain.Model').click();
  await page.getByRole('button', { name: 'Explore component' }).click();
  await page.getByTestId('rf__node-Domain.Model.Order').click();
  await expect(page.locator('aside h2')).toHaveText('Order');
  await page.getByRole('textbox', { name: 'Session ID' }).fill('browser-one');
  await page.getByRole('button', { name: 'Send to session' }).click();
  await expect(page.getByRole('alert')).toContainText('browser-one');
  const context = await page.evaluate(async () => {
    const b = await (await fetch('/api/bootstrap')).json();
    const url =
      '/api/context?project=' +
      b.project.id +
      '&snapshot=' +
      b.snapshotId +
      '&session=';
    return {
      one: await (await fetch(url + 'browser-one')).json(),
      two: await (await fetch(url + 'browser-two')).json(),
    };
  });
  expect(context.one.context.selection).toEqual(['Domain.Model.Order']);
  expect(context.two.context).toBeNull();

  await page
    .getByRole('button', { name: /src\/Domain\/Model\/Order.php:/ })
    .click();
  await expect(page.getByRole('dialog', { name: 'Source' })).toContainText(
    'class Order',
  );
  await page.getByRole('button', { name: 'Close source' }).click();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('.react-flow__node').filter({ hasText: 'Html' }).click();
  await page.getByRole('button', { name: /src\/Html.php:/ }).click();
  await expect(page.getByRole('dialog', { name: 'Source' })).toContainText(
    '<img src=x',
  );
  expect(
    await page.evaluate(() => (window as any).SOURCE_EXECUTED),
  ).toBeUndefined();
  await expect(page.getByRole('dialog').locator('img')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close source' }).click();
  await page.getByRole('button', { name: 'New proposal' }).click();
  const editor = page.getByRole('textbox', { name: 'Proposal JSON' });
  const draft = JSON.parse(await editor.inputValue());
  draft.name = 'Browser plan';
  draft.layers = [
    { id: 'inner', label: 'Inner', nses: ['Domain'] },
    {
      id: 'outer',
      label: 'Outer',
      nses: ['Infrastructure', 'Application', 'Http'],
    },
  ];
  await editor.fill(JSON.stringify(draft));
  await page.getByRole('button', { name: 'Save proposal' }).click();
  await page
    .getByRole('combobox', { name: 'Architecture mode' })
    .selectOption(draft.id);
  await expect(page.locator('.proposal-notice')).toContainText(
    'not instantiated in code',
  );
  await expect(
    page.locator('.react-flow__node').filter({ hasText: 'Inner' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('.proposal-notice')).toContainText('Browser plan');
  await page.getByRole('button', { name: 'Edit / rename' }).click();
  const renamed = JSON.parse(await editor.inputValue());
  renamed.name = 'Renamed plan';
  await editor.fill(JSON.stringify(renamed));
  await page.getByRole('button', { name: 'Save proposal' }).click();
  await expect(page.locator('.proposal-notice')).toContainText('Renamed plan');
  await page.getByRole('button', { name: 'Delete proposal' }).click();
  await expect(
    page.getByRole('combobox', { name: 'Architecture mode' }),
  ).toHaveValue('');
  await page.getByRole('button', { name: 'Rescan', exact: true }).click();
  await expect(page.getByText('Analyzing source files…')).toHaveCount(0);
  await expect(page.getByTestId('rf__node-Domain')).toBeVisible();
  expect(failures).toEqual([]);
});
