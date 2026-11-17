const task=await takeOverTaskSpace(3);
const tabs=await task.tabs();
for(const t of tabs){
 const p=t.label?task.page(t.label):await task.adopt(t.page);
 console.log({url:await p.url(),title:await p.title()});
 console.log(await p.snapshot());
}
