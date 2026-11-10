'use strict';

const editorParams = new URLSearchParams(location.search);
let reactionId = editorParams.get('reaction');

async function loadReactionStructure() {
 const reaction = await ReactionStore.read(reactionId);
 const slot = editorParams.get('slot');
 if (!reaction || !['START','FINISH'].includes(slot) || !reaction[slot]) {
  throw Error('指定した反応構造は見つかりません。');
 }
 return {...reaction[slot],name:reaction.name+'_'+slot};
}

let savedStartName;
let reactionSaving = false;
const startSuffix = /[_＿]START$/i;
const endpointSuffix = /[_＿](?:START|FINISH)$/i;

function startName() {
 return savedStartName || molecule?.name || '';
}

function syncReactionSave() {
 const isStart = startSuffix.test(startName());
 $('saveReaction').disabled = reactionSaving || !molecule;
 $('saveReaction').textContent = isStart ? '対応する生成物として保存' : '反応出発物として保存';
 $('saveReactionStart').hidden = !isStart;
 $('saveReactionStart').disabled = reactionSaving;
}

async function saveReactionStructure(asFinish) {
 if (!atoms.length || reactionSaving) return;
 reactionSaving = true;
 syncReactionSave();
 try {
  const name = Mol.safeName(startName().replace(endpointSuffix,''));
  const slot = asFinish ? 'FINISH' : 'START';
  const structure = {...editedRecord(name+'_'+slot),revision:crypto.randomUUID()};
  let saved;
  if (asFinish) {
   let reaction = reactionId ? await ReactionStore.read(reactionId) : null;
   if (!reactionId) {
    const matches = (await ReactionStore.read()).filter(item=>item.name===name && item.START);
    if (matches.length!==1) throw Error('対応する反応を特定できません。反応ライブラリからSTARTを開いてください。');
    reaction = matches[0];
   }
   if (!reaction?.START) throw Error('対応する反応のSTARTが見つかりません。');
   if (reaction.FINISH && !await Mol.confirmFileAction('生成物の上書き',reaction.name+'_FINISH を上書きしますか？','生成物を上書きする')) return;
   saved = await ReactionStore.update(reaction.id,{FINISH:structure},current=>
    !!current.FINISH===!!reaction.FINISH && current.FINISH?.revision===reaction.FINISH?.revision);
  } else {
   saved = await ReactionStore.create('START',structure,name);
   savedStartName = saved.name+'_START';
   $('title').textContent = savedStartName;
   document.title = savedStartName+' — 分子エディタ';
  }
  reactionId = saved.id;
  notice(saved.name+'_'+slot+' を反応ライブラリに保存しました。');
 } catch (error) { notice(error.message); }
 finally { reactionSaving = false; syncReactionSave(); }
}
$('saveReaction').onclick = () => void saveReactionStructure(startSuffix.test(startName()));
$('saveReactionStart').onclick = () => void saveReactionStructure(false);
