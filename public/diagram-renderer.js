mermaid.initialize({startOnLoad:false,securityLevel:'strict',theme:'base',themeVariables:{primaryColor:'#fff2e8',primaryTextColor:'#222222',primaryBorderColor:'#cc8b65',lineColor:'#71695f',secondaryColor:'#edf5ea',tertiaryColor:'#edf0fa',fontFamily:'system-ui',fontSize:'16px'},htmlLabels:false,flowchart:{htmlLabels:false},suppressErrorRendering:true});
addEventListener('message',async event=>{
  if(event.source!==parent || typeof event.data?.id!=='string' || typeof event.data.source!=='string')return;
  const {id,source}=event.data;
  try{
    // Agent text cannot override renderer security or inject custom CSS.
    if(source.length>50000 || /%%\s*\{|^\s*---/m.test(source))throw Error('Diagram configuration is not supported');
    const {svg}=await mermaid.render('diagram-'+crypto.randomUUID(),source);
    parent.postMessage({id,svg},event.origin);
  }catch{parent.postMessage({id,error:true},event.origin);}
});
