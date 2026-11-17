const task = await takeOverTaskSpace(3);
console.log((await task.tabs()).map(t=>({label:t.label,title:t.title,url:t.url})));
const tabs = await task.tabs();
const gh = tabs.find(t=>new URL(t.url).hostname==='github.com');
if(gh){const page=gh.label?task.page(gh.label):await task.adopt(gh.page);await page.goto('https://github.com/settings/installations');console.log(await page.snapshot());}
