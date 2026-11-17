const task=await taskSpace('Vibe first content editorial review');
const page=task.page('p1');
await page.goto('file:///D:/Vibe/docs/marketing/content-review.html');
console.log({spaceId:task.spaceId,page:page.label,title:await page.title(),url:await page.url()});
console.log(await page.snapshot());
