'use strict';

{
  const dialog = $('optDialog');
  const progress = $('optProgress');
  const status = $('optStatus');
  const inputs = [$('optCharge'), $('optMultiplicity'), $('optSteps')];
  const elements = Object.keys(Mol.elements);
  let worker = null;
  let method = 'GFN2';
  let externalRequest = null;
  const external = $('optExternal');
  const resultFile = $('optResultFile');
  let before = null;
  let preview = null;
  let showingPreview = false;

  function showStructure(usePreview) {
    showingPreview = usePreview;
    atoms = usePreview ? preview : before.atoms;
    $('optCompare').textContent = usePreview ? '元の構造を表示' : '最適化後を表示';
    dirty = true;
  }

  function stopWorker() {
    worker?.terminate();
    worker = null;
    progress.hidden = true;
    $('optClose').textContent = '閉じる';
    for (const input of inputs) input.disabled = false;
    $('optRun').hidden = false;
  }

  function reset() {
    stopWorker();
    if (preview && showingPreview) showStructure(false);
    preview = null;
    externalRequest = null;
    external.hidden = true;
    resultFile.value = '';
    $('optApply').hidden = $('optCompare').hidden = true;
  }

  function openOptimization(engine) {
    method = engine;
    if (atoms.length < 2) return;
    finishKeys();
    finishRotation();
    $('optTitle').textContent = method+'-xTB 構造最適化';
    $('optRun').textContent = method==='GFN0'?'コマンドを生成':'計算開始';
    status.textContent = method==='GFN0'
      ? '公式xTBで実行するコマンドを生成し、結果をこの画面に読み戻します。'
      : '初回の計算開始時に約29 MBの計算エンジンを読み込みます。';
    $('optTarget').textContent = selected.size
      ? `選択した ${selected.size} 原子を独立した系として最適化します。`
      : `全 ${atoms.length} 原子を最適化します。`;
    dialog.showModal();
  }
  $('optimize').onclick = () => openOptimization('GFN2');
  $('optimizeGfn0').onclick = () => openOptimization('GFN0');
  $('optClose').onclick = () => dialog.close();
  dialog.addEventListener('close', reset);
  $('optCompare').onclick = () => showStructure(!showingPreview);
  $('optApply').onclick = () => {
    if (!preview) return;
    const optimized = preview;
    reset();
    atoms = optimized;
    dirty = true;
    push(before);
    dialog.close();
    notice('最適化した座標を適用しました。Undoで戻せます。');
  };

  function presentResult(indices, coordinates, summary, label) {
    preview = before.atoms.slice();
    indices.forEach((index, i) => {
      preview[index] = {...before.atoms[index],
        x: coordinates[3*i], y: coordinates[3*i+1], z: coordinates[3*i+2]};
    });
    showStructure(true);
    status.textContent = summary;
    $('optRun').hidden = true;
    $('optCompare').hidden = $('optApply').hidden = false;
    $('optApply').textContent = label;
    $('optClose').textContent = '結果を破棄';
  }

  $('optInput').onclick = () => {
    if (externalRequest) Mol.downloadBlob(externalRequest.input, 'gfn0-input.xyz');
  };

  resultFile.onchange = async () => {
    const file = resultFile.files[0], request = externalRequest;
    resultFile.value = '';
    if (!file || !request) return;
    try {
      const blocks = [];
      for await (const block of Mol.parseFile(file)) {
        if (block.error || blocks.length) throw new Error('1構造だけの有効なXYZを選択してください。');
        blocks.push(block);
      }
      const result = blocks[0]?.atoms, {geometry, indices, anchor} = request;
      if (!result || result.length !== indices.length ||
          result.some((atom,i) => atom.el !== geometry.elements[i])) {
        throw new Error('入力と結果の原子数・元素順が一致しません。');
      }
      const {alignGeometry} = await import('./align-geometry.js');
      if (externalRequest !== request || !dialog.open) return;
      const coords = Float64Array.from(result.flatMap(({x,y,z}) => [x,y,z]));
      external.hidden = true;
      presentResult(indices, alignGeometry(geometry.coordinates,coords,anchor),
        'GFN0の結果XYZを読み込みました。収束の有無はxTBの出力ログを確認してください。', '座標を適用');
    } catch (error) {
      if (externalRequest === request) status.textContent = '読み込み失敗：'+error.message;
    }
  };

  $('optForm').onsubmit = event => {
    event.preventDefault();
    if (worker || preview) return;
    const [charge, multiplicity, maxCycles] = inputs.map(input => input.valueAsNumber);
    const indices = selected.size ? [...selected].sort((a, b) => a - b) : atoms.map((_, i) => i);
    const target = indices.map(i => atoms[i]);
    if (target.length < 2) {
      status.textContent = '最適化する原子を2個以上選択してください。';
      return;
    }
    const unsupported = target.find(atom => elements.indexOf(atom.el) < 0 ||
      elements.indexOf(atom.el) >= 86);
    const electrons = target.reduce((total, atom) => total + elements.indexOf(atom.el) + 1, -charge);
    if (unsupported) {
      status.textContent = method+'-xTBの対応範囲はH〜Rnです。対象外の元素：' + unsupported.el;
      return;
    }
    if (electrons < multiplicity || (electrons - multiplicity + 1) % 2 !== 0) {
      status.textContent = '電子数とスピン多重度が合いません。全電荷と多重度を確認してください。';
      return;
    }
    if (target.length > 200) {
      status.textContent = 'ブラウザでの計算上限は200原子です。';
      return;
    }

    before = snapshot();
    const geometry = {
      elements: target.map(atom => atom.el),
      coordinates: Float64Array.from(target.flatMap(({x, y, z}) => [x, y, z])),
    };
    if (method==='GFN0') {
      const input = new Blob([Mol.standard({atoms:target,comment:''})],{type:'chemical/x-xyz'});
      externalRequest = {input, geometry, indices, anchor:indices.indexOf(before.point)};
      $('optCommand').value = `printf '%s\n' '$opt' ' maxcycle=${maxCycles}' '$end' > gfn0.inp
xtb gfn0-input.xyz --gfn 0 --chrg ${charge} --uhf ${multiplicity-1} --opt --input gfn0.inp`;
      external.hidden = false;
      for (const field of inputs) field.disabled = true;
      $('optRun').hidden = true;
      status.textContent = '入力XYZを保存し、実行後に結果を選択してください。';
      return;
    }
    try {
      worker = new Worker('optimize-worker.js', {type: 'module'});
      worker.onerror = event => {
        stopWorker();
        status.textContent = '計算エンジンを実行できませんでした。' + (event.message || '');
      };
      worker.onmessage = ({data}) => {
        if (data.type === 'ready') {
          status.textContent = '初期構造を評価中…';
        } else if (data.type === 'electronic') {
          status.textContent = `電子状態評価：SCC ${data.sccIterations} 回 · 累計 ${data.sccTotal} 回`;
        } else if (data.type === 'cycle') {
          progress.value = data.cycle;
          status.textContent = `ステップ ${data.cycle} / ${maxCycles} · ${data.energy.toFixed(6)} Eh · SCC ${data.sccIterations} 回（累計 ${data.sccTotal} 回）`;
        } else if (data.type === 'error') {
          stopWorker();
          status.textContent = /(?:SCC|SCF).*?(?:not converge|failed)/i.test(data.message)
            ? `計算失敗：電子状態（SCC）が収束しませんでした。成功した評価のSCC累計 ${data.sccTotal} 回。詳細：${data.message}`
            : '計算失敗：' + data.message;
        } else if (data.type === 'result') {
          stopWorker();
          const {coordinates, energy, converged, cycles} = data.result;
          presentResult(indices, coordinates,
            `${converged ? '収束' : '未収束の最終構造'} · ${cycles} ステップ · ${energy.total.toFixed(6)} Eh · SCC累計 ${data.result.sccTotal} 回（初期・最終評価を含む）`
            + (multiplicity > 1 ? '。開殻はOCCのスピン分極モデルです。' : ''),
            converged ? '座標を適用' : '未収束の座標を適用');

        }
      };
      for (const input of inputs) input.disabled = true;
      $('optRun').hidden = true;
      $('optClose').textContent = '計算を中止';
      progress.hidden = false;
      progress.max = maxCycles;
      progress.value = 0;
      status.textContent = '計算エンジンを読み込み中…';
      worker.postMessage({geometry, anchor: indices.indexOf(before.point), settings: {charge, unpairedElectrons: multiplicity - 1, maxCycles}});
    } catch (error) {
      stopWorker();
      status.textContent = '計算を開始できませんでした：' + error.message;
    }
  };
}
