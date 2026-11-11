import {chromium} from 'playwright';
import {mkdir,mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {startApp} from '../app/server.ts';
const work=await mkdtemp(join(tmpdir(),'stellaris-browser-'));
const app=await startApp({port:0,host:'127.0.0.1',dbPath:join(work,'app.sqlite'),autoTick:false});
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const errors:string[]=[];const results:any[]=[];const screenshots=resolve('integration/screenshots');await mkdir(screenshots,{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.stack??e.message));
 await page.goto(`http://127.0.0.1:${app.port}`);await page.getByRole('heading',{name:'指挥中心',exact:true}).waitFor();
 assert(await page.getByText('MOCK 模拟环境',{exact:true}).isVisible());
 await page.getByRole('textbox',{name:'向总统发送指令'}).fill('优先科研，维持经济底线，保留边境防御能力');await page.getByRole('button',{name:'发送指令',exact:true}).click();
 await page.getByRole('button',{name:/查看本轮会议与报告/}).first().waitFor({timeout:15000});
 await page.getByRole('button',{name:/查看本轮会议与报告/}).first().click();await page.getByRole('button',{name:'最终报告',exact:false}).click();await page.getByText('国家阶段战略与会议决议',{exact:true}).waitFor();
 await page.getByRole('button',{name:'当时全局报告',exact:true}).click();assert(await page.getByText('这是该轮决策读取的历史快照，不会随当前对局变化。',{exact:true}).isVisible());
 await page.getByRole('button',{name:'各角色实际输入',exact:true}).click();assert(await page.locator('.role-input-card .role-label').filter({hasText:'经济部'}).count()>0);
 await page.screenshot({path:join(screenshots,'desktop-meeting.png'),fullPage:true});
 await page.getByRole('button',{name:'指挥中心',exact:true}).click();await page.getByRole('button',{name:/权限 ·/}).click();const dialog=page.getByRole('dialog',{name:'权限控制'});await dialog.waitFor();
 await dialog.getByRole('combobox').selectOption('partial');await page.waitForFunction(async()=>{const r=await fetch('/api/bootstrap');return (await r.json()).permissions.mode==='partial'});
 for(const [name,key] of [['科研选择','research'],['生产建设','construction']]){await dialog.getByRole('switch',{name:new RegExp(name)}).click();await page.waitForFunction(async(key)=>{const r=await fetch('/api/bootstrap');return (await r.json()).permissions[key]===true},key);await page.waitForTimeout(250);}
 await page.getByRole('button',{name:'关闭权限面板'}).click();await app.services.gov.replan('手动重新评估');
 for(let i=0;i<100&&app.services.gov.status().planning;i++)await page.waitForTimeout(30);
 await page.waitForTimeout(200);await app.services.admin.tick();await page.getByRole('button',{name:'状态与任务',exact:true}).click();await page.getByRole('button',{name:'行政任务',exact:true}).click();
 await page.waitForTimeout(400);assert(app.services.admin.calls().some(c=>c.origin==='agent'&&c.tool==='stellaris_select_research'));
 await page.getByRole('button',{name:'工具调试',exact:true}).click();await page.getByRole('textbox',{name:'搜索工具'}).fill('get_status');await page.locator('.tool-item').filter({hasText:'get_status'}).first().click();await page.getByRole('button',{name:/发起调用/}).click();await page.locator('.call-result').waitFor();
 await page.getByRole('button',{name:'模型与知识',exact:true}).click();await page.getByRole('heading',{name:'模型端点',exact:true}).waitFor();assert(await page.getByText('Base URL',{exact:true}).isVisible());
 results.push({viewport:'1440×1000',chat:true,meetingReports:true,historicalSnapshot:true,actualRoleInputs:true,permissions:true,adminCall:true,tools:true,config:true});
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'指挥中心',exact:true}).click();await page.screenshot({path:join(screenshots,'mobile-chat.png'),fullPage:true});
 const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(sizes.scroll<=sizes.width+1,`手机水平溢出 ${sizes.scroll}/${sizes.width}`);
 await page.getByRole('button',{name:/权限 ·/}).click();await page.getByRole('dialog',{name:'权限控制'}).waitFor();await page.screenshot({path:join(screenshots,'mobile-permissions.png'),fullPage:true});await page.getByRole('button',{name:'关闭权限面板'}).click();
 results.push({viewport:'390×844',noHorizontalOverflow:true,chat:true,permissions:true});assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,results,consoleErrors:errors},null,2));
}catch(error){console.error(JSON.stringify({errors,gov:app.services.gov.status(),decisions:app.services.gov.decisions().map(d=>({status:d.status,error:d.error})),body:await browser.contexts()[0]?.pages()[0]?.locator('body').innerText()},null,2));await browser.contexts()[0]?.pages()[0]?.screenshot({path:join(screenshots,'failure.png'),fullPage:true});throw error;}finally{await browser.close();await app.close();await rm(work,{recursive:true,force:true});}
