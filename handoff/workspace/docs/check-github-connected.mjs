const task = await takeOverTaskSpace(3);
const tabs = await task.tabs();
const page = (await task.pages())[0] ?? await task.adopt(tabs[0].page);
console.log({spaceId:task.spaceId,page:page.label,url:await page.url()});
await page.goto('https://github.com/settings/installations');
console.log(await page.snapshot());
