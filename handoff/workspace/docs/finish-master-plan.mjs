const task = await taskSpace(2);
const page = task.page('p1');
await page.cdp('Emulation.clearDeviceMetricsOverride');
await page.reload();
await task.finish({keep:['p1']});
