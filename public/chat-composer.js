export function setupChatComposer({form,input,send,onInput,onFiles}) {
  input.addEventListener('keydown',event=>{
    if(event.defaultPrevented||event.isComposing||event.keyCode===229)return;
    if(event.key==='Enter'&&!event.shiftKey&&!event.altKey){event.preventDefault();if(!event.repeat&&!send.disabled)form.requestSubmit();}
  });
  input.addEventListener('input',()=>{input.style.height='auto';input.style.height=Math.min(input.scrollHeight,260)+'px';onInput();});
  input.addEventListener('paste',event=>{
    const files=[...(event.clipboardData?.items||[])].filter(item=>item.kind==='file').map(item=>item.getAsFile()).filter(Boolean);
    if(files.length){event.preventDefault();void onFiles(files);}
  });
  form.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files'))event.preventDefault();});
  form.addEventListener('drop',event=>{const files=[...(event.dataTransfer?.files||[])];if(files.length){event.preventDefault();void onFiles(files);}});
}
