const task = await taskSpace("Vibe frontend deployment");
const page = task.page("p1");
await page.goto("https://vercel.com/dashboard");
console.log({spaceId:task.spaceId});
console.log(await page.snapshot());
