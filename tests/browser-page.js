// Existing UI checks exercise their own flows; tutorial checks use a fresh page.
export async function newPageWithoutTutorials(browserOrContext, options) {
 const page=await browserOrContext.newPage(options);
 await page.addInitScript(()=>{
  const workspace=new URLSearchParams(location.search).get('workspace')||'default';
  localStorage.setItem('odwyn-tutorials'+(workspace==='default'?'':':'+workspace),JSON.stringify({hidden:true,seen:[]}));
 });
 return page;
}
