import {expect,test} from '@playwright/test';
const password=process.env.DEMO_E2E_PASSWORD;
test.describe('official Demo smoke journeys',()=>{
  test.skip(!password,'DEMO_E2E_PASSWORD is required and must be supplied only by the test environment.');
  test.beforeEach(async({page})=>{
    await page.goto('/login');
    await expect(page.getByRole('heading',{name:'Sign in to your account'})).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Demo Mode Active|Official demo account|Demo Credentials/i);
    await page.getByLabel(/email/i).fill('demo@neozy.in');
    await page.getByLabel(/password/i).fill(password!);
    await page.getByRole('button',{name:/sign in|login/i}).click();
    await expect(page).not.toHaveURL(/login/,{timeout:15_000});
  });

  test('dashboard and primary lifecycle routes render without runtime exceptions',async({page})=>{
    const runtimeErrors:string[]=[];
    let currentRoute='boot';
    page.on('pageerror',(error)=>runtimeErrors.push(`${currentRoute}: ${error.stack||error.message}`));
    page.on('console',(message)=>{if(message.type()==='error')runtimeErrors.push(`${currentRoute}: console: ${message.text()}`)});
    for(const route of ['/','/leads','/customers','/projects','/quotations','/orders','/invoices','/payments','/purchase-orders','/stock','/dispatch','/qc','/commissioning','/net-metering','/subsidy','/project-handover','/amc-contracts','/service-tickets','/monitoring']){
      currentRoute=route;
      await page.goto(route);
      await expect(page.locator('body')).not.toContainText(/permission denied|application error/i);
      await page.waitForTimeout(750);
    }
    expect(runtimeErrors).toEqual([]);
  });

  test('seeded quotation document resolves its customer contract',async({page},testInfo)=>{
    // The standalone quotation popup was retired (Quotation Workspace
    // Migration): desktop opens the /quotations/:id detail page, mobile keeps
    // its own record workspace.
    await page.goto('/quotations/DEMO-V1-QUO-001');
    await expect(page.locator('body')).toContainText('Demo Customer 03');
    if(testInfo.project.name==='mobile') {
      await expect(page.getByRole('button',{name:/DQT-0001 Demo Customer 03/i})).toBeVisible();
      return;
    }
    await expect(page.getByRole('button',{name:/Download PDF/i})).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/Failed:.*toUpperCase/i);
  });

  test('Demo external communication actions are safely blocked',async({page},testInfo)=>{
    let popupCount=0;
    page.on('popup',()=>popupCount++);
    await page.goto('/quotations?open=DEMO-V1-QUO-001');
    if(testInfo.project.name==='mobile'){
      const before=page.url();
      const quotationDialog=page.getByRole('dialog');
      await expect(quotationDialog).toBeVisible();
      await quotationDialog.getByRole('link',{name:'Call',exact:true}).click();
      await expect(page.getByText('External communication is disabled for the Demo tenant.')).toBeVisible();
      expect(page.url()).toBe(before);
    }else{
      // Desktop: the retired popup's Send Email button is now the detail
      // page's Send Quotation quick action (quotationEmail.ts, same runtime).
      await page.goto('/quotations/DEMO-V1-QUO-001');
      await page.getByRole('button',{name:'Send Quotation'}).click();
      await expect(page.getByText(/Could not open Gmail compose/i)).toBeVisible();
    }
    expect(popupCount).toBe(0);
  });

  test('direct foreign document route fails safely',async({page})=>{
    await page.goto('/projects/PRODUCTION-DOCUMENT-ID');
    await expect(page.locator('body')).not.toContainText(/Secret Production/i);
  });
});