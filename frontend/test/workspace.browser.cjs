// Read-only Chrome smoke for the function-card overview and trace dialog.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const local = require('dotenv').parse(fs.readFileSync(path.resolve(__dirname, '../../backend/.env')));
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const web = process.env.WORKSPACE_WEB_URL || 'http://localhost:5173';
async function run() {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROME_EXECUTABLE ? {executablePath:process.env.CHROME_EXECUTABLE} : {})});
  try {
    for (const role of ['MANAGER','TECHNICIAN']) {
      const page = await browser.newPage({viewport:{width:1440,height:1000}});
      await page.goto(web);
      await page.getByLabel('Email',{exact:true}).fill(local[`DEMO_${role}_EMAIL`] || (role==='MANAGER'?'manager.demo@example.local':'technician.demo@example.local'));
      await page.getByLabel('Mật khẩu',{exact:true}).fill(local[`DEMO_${role}_PASSWORD`]);
      await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
      await page.locator('.project-row').filter({hasText:'CT-DEMO-ELV-01'}).click();
      await page.locator('.overview-links').waitFor();
      assert.equal(await page.locator('.overview-links button').count(),6);
      assert.equal(await page.locator('.devices-panel,.tasks-panel,.connections-panel,.inspection-panel,.detail-grid,.rack-workspace').count(),0);
      const shot = async name => { if(process.env.WORKSPACE_ARTIFACT_DIR) await page.screenshot({path:path.join(process.env.WORKSPACE_ARTIFACT_DIR,name),fullPage:true}); };
      if(role==='MANAGER') await shot('workspace-cards-desktop.png');
      await page.setViewportSize({width:390,height:844});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      if(role==='MANAGER') await shot('workspace-cards-mobile.png');
      await page.locator('.overview-links').getByRole('button',{name:/Đấu nối & tra cứu/}).focus(); await page.keyboard.press('Enter');
      for(const code of ['CAM-DIRECT','CAM-PANEL','CAM-OUTLET']) {
        await page.getByLabel('Mã tra cứu',{exact:true}).fill(code);
        await page.getByRole('button',{name:'Tra đường đi',exact:true}).click();
        const dialog=page.getByRole('dialog'); await dialog.waitFor();
        await dialog.getByText('Đủ hồ sơ đường dây tới switch',{exact:false}).waitFor();
        assert.equal(await dialog.evaluate(el=>el===document.activeElement),true,'No editable field: initial focus falls back to dialog');
        await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
        await page.keyboard.press('Shift+Tab'); assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        if(role==='MANAGER'&&code==='CAM-OUTLET') await shot('workspace-trace-mobile.png');
        await page.keyboard.press('Escape'); await dialog.waitFor({state:'hidden'});
      }
      await page.getByRole('button',{name:'Về tổng quan',exact:true}).click(); await page.locator('.overview-links').waitFor();
      assert.equal(await page.locator('.connections-panel').count(),0); await page.close();
    }
    console.log('PASS six function cards only, desktop/390px, both roles, keyboard and three real camera trace dialogs; no writes.');
  } finally { await browser.close(); }
}
run().catch(error=>{ console.error(`Workspace smoke failed: ${error.name}`); process.exitCode=1; });
