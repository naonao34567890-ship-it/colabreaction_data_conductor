'use strict';

{
 const dialog=$('tagDialog'), list=$('tagList'), form=$('tagForm'), input=$('tagName');
 const status=$('tagStatus');
 let renameMode=false, renameFrom=null;
 let targets=[], deletingTags=false, busy=false, tags=[];

 async function transact(mode, run) {
  if(mode==='readwrite'&&Mol.cloud)return Mol.cloud.call('tagsTransaction',run);
  const db=await Mol.db();
  return new Promise((resolve,reject)=>{
   const tx=db.transaction(['tags','meta'],mode);
   const catalog=tx.objectStore('tags'), meta=tx.objectStore('meta');
   let result, failure;
   tx.oncomplete=()=>resolve(result);
   tx.onabort=()=>reject(failure||tx.error||Error('タグの処理を完了できませんでした。'));
   run(catalog,meta,value=>{result=value;},message=>{failure=Error(message);tx.abort();});
  });
 }

 async function readTags() {
  return transact('readonly',(catalog,meta,done)=>{
   const request=catalog.getAllKeys();
   request.onsuccess=()=>{
    const entries=request.result.sort(Mol.compareTagNames).map(name=>({name,count:0}));
    for(const tag of entries){
     const usage=meta.index('tags').count(tag.name);
     usage.onsuccess=()=>{tag.count=usage.result;};
    }
    done(entries);
   };
  });
 }

 function renderTags() {
  list.replaceChildren();
  if(!tags.length)list.textContent='タグはまだありません。';
  for(const {name,count} of tags){
   const entry=document.createElement('div');
   entry.className='tag-entry';
   if(deletingTags){
    const remove=document.createElement('button');
    remove.type='button';
    remove.textContent='×';
    remove.className='danger';
    remove.setAttribute('aria-label',name+'を削除');
    remove.title=count?count+' 件で使用中':'タグを削除';
    remove.disabled=busy||count>0;
    remove.onclick=()=>mutate(async()=>{
     await transact('readwrite',(catalog,meta,done,abort)=>{
      const usage=meta.index('tags').count(name);
      usage.onsuccess=()=>{
       if(usage.result)abort('使用中のタグは削除できません。');
       else catalog.delete(name);
      };
     });
     Mol.notify({type:'tag-catalog'});
     await refreshTags();
    });
    entry.append(remove);
   }
   const button=document.createElement('button');
   button.type='button';
   button.className='tag-choice';
   button.textContent=name;
   button.title=name;
   button.disabled=busy;
   button.onclick=()=>{
    if(!renameMode){void changeTag(name,true);return;}
    renameFrom=name;
    input.value=name;
    form.hidden=false;
    renderTags();
    input.focus();
    input.select();
   };
   const untag=document.createElement('button');
   untag.type='button';
   untag.className='danger tag-choice';
   untag.textContent='「'+name+'」を外す';
   untag.title=untag.textContent;
   untag.disabled=busy||!targets.some(id=>metaMap.get(id)?.tags?.includes(name));
   untag.onclick=()=>changeTag(name,false);
   const choices=document.createElement('div');
   choices.className='tag-choices';
   choices.append(button);
   if(!renameMode)choices.append(untag);
   entry.append(choices);
   list.append(entry);
  }
  $('tagCreate').disabled=busy||input.value.includes('\t')||!input.value.trim();
  $('tagRename').disabled=busy||!tags.length;
  $('tagNew').disabled=$('tagDelete').disabled=$('tagCancel').disabled=busy;
 }

 function changeTag(name,attach) {
  return mutate(async()=>{
   const updated=await transact('readwrite',(catalog,meta,done,abort)=>{
    const exists=catalog.getKey(name);
    exists.onsuccess=()=>{
     if(exists.result===undefined){abort('このタグは削除されています。');return;}
     const items=[];
     done(items);
     for(const id of targets){
      const request=meta.get(id);
      request.onsuccess=()=>{
       const item=request.result;
       if(!item)return;
       const tags=item.tags||[];
       if(!attach&&!tags.includes(name))return;
       item.tags=attach?[...new Set([...tags,name])].sort(Mol.compareTagNames)
        :tags.filter(tag=>tag!==name);
       meta.put(item);
       items.push(item);
      };
     }
    };
   });
   const change={type:'tags-updated',items:updated};
   applyChange(change);
   Mol.notify(change);
   dialog.close();
   notice(attach?updated.length+' 件に「'+name+'」を付けました。'
    :updated.length+' 件から「'+name+'」を外しました。');
  });
 }

 async function refreshTags() {
  tags=await readTags();
  renderTags();
 }

 async function mutate(action) {
  if(busy)return;
  busy=true;
  renderTags();
  try{await action();}
  catch(error){
   try{await refreshTags();}catch{}
   status.textContent=error.message;
  }finally{busy=false;renderTags();}
 }

 $('tagSelected').onclick=()=>{
  targets=[...selected].filter(id=>metaMap.has(id)&&!metaMap.get(id).builtin);
  if(!targets.length)return;
  deletingTags=false;
  renameMode=false;renameFrom=null;
  $('tagCreate').textContent='作成';
  $('tagDelete').setAttribute('aria-pressed','false');
  $('tagDelete').textContent='タグの削除';
  form.hidden=true;
  input.value='';
  tags=[];
  status.textContent=targets.length+' 件の分子に付けるタグを選んでください。';
  dialog.showModal();
  void mutate(refreshTags);
 };
 $('tagNew').onclick=()=>{
  renameMode=false;renameFrom=null;
  $('tagCreate').textContent='作成';
  input.value='';form.hidden=false;renderTags();input.focus();
 };
 $('tagRename').onclick=()=>{
  renameMode=true;renameFrom=null;deletingTags=false;
  $('tagDelete').setAttribute('aria-pressed','false');
  $('tagDelete').textContent='タグの削除';
  $('tagCreate').textContent='更新';
  form.hidden=true;
  status.textContent='名前を変更するタグを選んでください。';
  renderTags();
 };
 $('tagDelete').onclick=()=>{
  if(renameMode){renameMode=false;renameFrom=null;form.hidden=true;$('tagCreate').textContent='作成';}
  deletingTags=!deletingTags;
  $('tagDelete').setAttribute('aria-pressed',String(deletingTags));
  $('tagDelete').textContent=deletingTags?'削除モードを終了':'タグの削除';
  void mutate(refreshTags);
 };
 $('tagCancel').onclick=()=>dialog.close();
 dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
 const tabError='タグ名にタブ文字は使えません。';
 input.oninput=()=>{
  const hasTab=input.value.includes('\t');
  $('tagCreate').disabled=busy||hasTab||!input.value.trim();
  if(hasTab)status.textContent=tabError;
  else if(status.textContent===tabError)status.textContent='';
 };
 form.onsubmit=event=>{
  event.preventDefault();
  if(input.value.includes('\t')){
   status.textContent=tabError;
   return;
  }
  const name=input.value.trim();
  if(!name)return;
  void mutate(async()=>{
   if(renameFrom!==null){
    const from=renameFrom;
    renameFrom=null;input.value='';form.hidden=true;
    const updated=await transact('readwrite',(catalog,meta,done,abort)=>{
     const keys=catalog.getAllKeys();
     keys.onsuccess=()=>{
      if(keys.result.includes(name)){abort('同じ名前のタグがあります。');return;}
      if(!keys.result.includes(from)){abort('このタグは削除されています。');return;}
      const matches=meta.index('tags').getAll(from);
      matches.onsuccess=()=>{
       for(const item of matches.result){
        item.tags=item.tags.map(tag=>tag===from?name:tag).sort(Mol.compareTagNames);
        meta.put(item);
       }
       catalog.delete(from);
       catalog.add({name});
       done(matches.result);
      };
     };
    });
    const change={type:'tags-updated',items:updated};
    applyChange(change);
    Mol.notify(change);
    Mol.notify({type:'tag-catalog'});
    status.textContent='「'+name+'」に変更しました。';
    await refreshTags();
    return;
   }
   if(tags.some(tag=>tag.name===name))throw Error('同じ名前のタグがあります。');
   await transact('readwrite',catalog=>catalog.add({name}));
   input.value='';
   form.hidden=true;
   status.textContent='「'+name+'」を作成しました。タグを選ぶと付与できます。';
   Mol.notify({type:'tag-catalog'});
   await refreshTags();
  });
 };
 document.addEventListener('drive-store-updated',()=>{if(dialog.open&&!busy)void mutate(refreshTags);});
 channel.addEventListener('message',({data})=>{
  if(dialog.open&&!busy&&['tags-updated','tag-catalog','deleted'].includes(data.type))void mutate(refreshTags);
 });
}
