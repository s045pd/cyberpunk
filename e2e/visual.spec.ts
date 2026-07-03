import { test, expect, Page } from '@playwright/test';

async function jackIn(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  await page.goto('/');
  const start = page.locator('.boot-start');
  await expect(start).toBeEnabled({ timeout: 90_000 });
  await start.click();
  await page.waitForTimeout(4000); // 等待首批帧稳定
  return errors;
}

test('飞行模式首帧渲染且无页面错误', async ({ page }, testInfo) => {
  const errors = await jackIn(page);
  await expect(page.locator('#scene')).toBeVisible();
  await expect(page.locator('.hud-district')).not.toBeEmpty();
  await page.screenshot({
    path: testInfo.outputPath('fly-mode.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test('切换漫游模式后正常渲染', async ({ page }, testInfo) => {
  const errors = await jackIn(page);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(2500); // 降落过渡完成
  await page.screenshot({
    path: testInfo.outputPath('walk-mode.png'),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
