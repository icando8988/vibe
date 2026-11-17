const task = await taskSpace('Vibe master development plan review');
const page = task.page('p1');
await page.goto('file:///D:/Vibe/docs/MASTER_DEVELOPMENT_PLAN.html');
console.log({spaceId:task.spaceId,page:page.label});
console.log(await page.evaluate(()=>({title:document.title,headings:document.querySelectorAll('h2').length,tables:document.querySelectorAll('table').length,brokenAnchors:[...document.querySelectorAll('a[href^="#"]')].filter(a=>!document.getElementById(a.hash.slice(1))).length,externalResources:[...document.querySelectorAll('script[src],link[rel="stylesheet"],img[src]')].length,bodyWidth:document.body.scrollWidth,viewport:innerWidth,text:document.querySelector('h1').innerText})));
console.log(await page.screenshot({path:'D:/Vibe/docs/MASTER_PLAN_DESKTOP.png'}));
await page.cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
console.log(await page.evaluate(()=>({mobileViewport:innerWidth,bodyWidth:document.body.scrollWidth,mobileToc:getComputedStyle(document.querySelector('.mobile-nav')).display})));
console.log(await page.screenshot({path:'D:/Vibe/docs/MASTER_PLAN_MOBILE.png'}));
