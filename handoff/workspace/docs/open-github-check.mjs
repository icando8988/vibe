const task = await taskSpace('Vibe service connection checks');
const page = task.page('p1');
await page.goto('https://github.com/settings/installations');
console.log({spaceId:task.spaceId,page:page.label,url:await page.url()});
console.log(await page.snapshot());
