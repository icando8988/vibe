const task = await taskSpace(3);
const vercel = await task.newPage();
await vercel.goto('https://vercel.com/dashboard');
console.log({service:'Vercel',page:vercel.label,url:await vercel.url()});
const supabase = await task.newPage();
await supabase.goto('https://supabase.com/dashboard');
console.log({service:'Supabase',page:supabase.label,url:await supabase.url()});
await task.handOff();
