"""Optional offline evaluation. No personal data, paid API or production model installation.
Uses the upstream author's pinned ONNX conversion, attention-mask mean pooling and L2 norm.
Requires locally available numpy, tokenizers and onnxruntime; changes no project dependencies.
"""
import argparse, ctypes, hashlib, importlib.metadata, json, os, pathlib, shutil, time, urllib.request

REVISION = '614241f622f53c4eeff9890bdc4f31cfecc418b3'
REPOSITORY = 'intfloat/multilingual-e5-small'
MODEL_FILE = 'onnx/model_qint8_avx512_vnni.onnx'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--input', default='work/search-evaluation/corpus.json')
    parser.add_argument('--output', default='work/search-evaluation/vector.json')
    args = parser.parse_args()
    root = pathlib.Path(args.input).parent
    root.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(root).free < 8 * 1024 ** 3:
        raise RuntimeError('Optional evaluation requires 8 GiB free; no files deleted')
    # Bound only this evaluation process, never the host or other services.
    if os.name == 'nt':
        kernel = ctypes.windll.kernel32
        process = kernel.GetCurrentProcess()
        process_mask, system_mask = ctypes.c_size_t(), ctypes.c_size_t()
        kernel.GetProcessAffinityMask(process, ctypes.byref(process_mask), ctypes.byref(system_mask))
        if process_mask.value:
            kernel.SetProcessAffinityMask(process, process_mask.value & -process_mask.value)
    elif hasattr(os, 'sched_setaffinity'):
        os.sched_setaffinity(0, {min(os.sched_getaffinity(0))})
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer
    files = {}
    for remote in [MODEL_FILE, 'tokenizer.json']:
        target = root / pathlib.Path(remote).name
        if not target.exists():
            temporary = target.with_suffix(target.suffix + '.partial')
            urllib.request.urlretrieve(f'https://huggingface.co/{REPOSITORY}/resolve/{REVISION}/{remote}', temporary)
            temporary.replace(target)
        files[remote] = hashlib.sha256(target.read_bytes()).hexdigest()
    tokenizer = Tokenizer.from_file(str(root / 'tokenizer.json'))
    tokenizer.enable_padding()
    tokenizer.no_truncation()
    corpus = json.loads(pathlib.Path(args.input).read_text(encoding='utf-8'))
    # Exact pinned tokenizer windows, excluding the prefix/special tokens from
    # the 384 content-token budget. Preserve existing formula sections atomically.
    token_chunks = []
    for document in corpus['documents']:
        for section in document['sections']:
            text = section['text']
            encoding = tokenizer.encode(text, add_special_tokens=False)
            for start in range(0,len(encoding.ids),352):
                end = min(start+384,len(encoding.ids))
                part = text[encoding.offsets[start][0]:encoding.offsets[end-1][1]]
                token_chunks.append({'documentId':document['id'],'section':section['name'],'tokens':end-start,'text':part,
                  'assets':document['assets'],'source':document['source'],'checkedAt':document['checkedAt'],'review':document['review'],
                  'contentHash':hashlib.sha256(part.encode()).hexdigest(),'indexVersion':corpus['indexVersion']})
                if end == len(encoding.ids): break
    (root/'model-token-chunks.json').write_text(json.dumps(token_chunks,ensure_ascii=False),encoding='utf-8')
    tokenizer.enable_truncation(max_length=512)
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(root / pathlib.Path(MODEL_FILE).name), options, providers=['CPUExecutionProvider'])
    input_names = {item.name for item in session.get_inputs()}
    def embed(texts, prefix):
        encodings = tokenizer.encode_batch([prefix + text for text in texts])
        ids = np.array([e.ids for e in encodings], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encodings], dtype=np.int64)
        feed = {'input_ids': ids, 'attention_mask': mask}
        if 'token_type_ids' in input_names:
            feed['token_type_ids'] = np.zeros_like(ids)
        hidden = session.run(None, feed)[0]
        vectors = (hidden * mask[..., None]).sum(1) / np.maximum(mask.sum(1)[:, None], 1)
        return vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-12)
    documents = [d for d in corpus['documents'] if d['kind'] == 'indicator']
    matrix = np.vstack([embed([d['title'] + ' ' + ' '.join(s['text'] for s in d['sections']) for d in documents[i:i+8]], 'passage: ') for i in range(0, len(documents), 8)])
    durations, successes, wrong = [], 0, 0
    for task, baseline in zip(corpus['tasks'], corpus['baseline']):
        start = time.perf_counter()
        vector = embed([task['q']], 'query: ')[0]
        allowed = corpus['allowedIndicators'][task['asset']]
        eligible = [i for i, d in enumerate(documents) if task['asset'] in d['assets'] and d['id'] in allowed]
        semantic = sorted(eligible, key=lambda i: -float(matrix[i] @ vector))[:20]
        fused = {}
        for rank, id_ in enumerate(baseline['ids']): fused[id_] = fused.get(id_, 0) + 1 / (60 + rank)
        for rank, i in enumerate(semantic):
            id_ = documents[i]['id']; fused[id_] = fused.get(id_, 0) + 1 / (60 + rank)
        hits = sorted(fused, key=lambda id_: -fused[id_])[:5]
        successes += 'indicator:' + task['metric'] in hits
        durations.append((time.perf_counter() - start) * 1000)
        wrong += any(next((d for d in documents if d['id'] == id_), {'assets': [task['asset']]})['assets'].count(task['asset']) == 0 for id_ in hits)
    baseline_success = sum(t['success'] for t in corpus['baseline'])
    improvement = (successes - baseline_success) / len(corpus['tasks']) * 100
    p95 = sorted(durations)[int(np.ceil(len(durations) * .95)) - 1]
    report = {'observedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'repository': REPOSITORY,
      'revision': REVISION, 'conversion': MODEL_FILE, 'fileSha256': files, 'indexVersion': corpus['indexVersion'],
      'versions': {p: importlib.metadata.version(p) for p in ['numpy', 'onnxruntime', 'tokenizers']},
      'environment': 'isolated local CPU affinity, one ONNX thread; not production VPS',
      'chunking': {'contentTokens':384,'overlapTokens':32,'chunks':len(token_chunks),'tokenizerRevision':REVISION},
      'tasks': len(durations), 'baselineTop5': baseline_success, 'fusedTop5': successes, 'improvementPercentagePoints': improvement,
      'wrongAssetResults': wrong, 'queryP95Ms': p95, 'productionEnabled': False,
      'qualityGatePassed': improvement >= 5 and wrong == 0,
      'latencyGatePassed': p95 <= 300,
      'reason': 'Production remains lexical unless every quality, VPS memory/disk and collection-regression gate passes'}
    pathlib.Path(args.output).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))

if __name__ == '__main__': main()
