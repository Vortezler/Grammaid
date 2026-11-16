// Refresh pinned model files and exact sizes. No model weights are downloaded here.
import { writeFile } from 'node:fs/promises';
const pairs = ['en-es', 'es-en', 'en-fr', 'fr-en', 'en-de', 'de-en', 'en-ru', 'ru-en', 'en-nl', 'nl-en', 'en-hi', 'hi-en', 'en-zh', 'zh-en', 'ja-en', 'ko-en', 'en-ROMANCE', 'ROMANCE-en', 'en-mul', 'mul-en'];
const repositories = pairs.map((pair) => `Xenova/opus-mt-${pair}`);
repositories.push('Xenova/nllb-200-distilled-600M');
repositories.push('hari31416/indictrans2-en-indic-dist-200M-ONNX-int8', 'hari31416/indictrans2-indic-en-dist-200M-ONNX-int8');
const models = {};
for (const id of repositories) {
  const response = await fetch(`https://huggingface.co/api/models/${id}?blobs=true`);
  if (!response.ok) throw new Error(`${id}: HTTP ${response.status}`);
  const info = await response.json();
  const indic = id.startsWith('hari31416/');
  const names = indic
    ? ['config.json', 'generation_config.json', 'tokenizer_src.json', 'tokenizer_tgt.json', 'tokenizer_meta.json', 'encoder_model.onnx', 'encoder_model.onnx.data', 'decoder_model.onnx', 'decoder_with_past_model.onnx', 'decoder_shared.onnx.data']
    : ['config.json', 'generation_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
  const files = names.map((name) => {
    const file = info.siblings.find((file) => file.rfilename === name);
    if (!file?.size) throw new Error(`${id}: missing ${name}`);
    return { name, bytes: file.size };
  });
  models[id] = { revision: info.sha, files };
  console.log(id, (files.reduce((sum, file) => sum + file.bytes, 0) / 1048576).toFixed(1), 'MiB');
}
await writeFile(new URL('../src/data/translation-models.json', import.meta.url), JSON.stringify(models, null, 2) + '\n');
