import sharp from 'sharp';
import { estimateModelCostMicros } from '../telemetry.ts';

/** Experimental upper estimate; the framing allowance is not a vendor guarantee. */
export async function estimateAstraWire(serialized: string, pricingJSON: string, fastReview: boolean) {
  const wire = JSON.parse(serialized);
  const reject = (): never => { throw new Error('Unsupported Astra budget request'); };
  const keys = ['model','service_tier','reasoning_effort','max_completion_tokens','store','stream','stream_options','messages'];
  if (Object.keys(wire).some(k => !keys.includes(k)) || wire.model !== 'gpt-6-astra'
    || wire.service_tier !== 'default' || wire.reasoning_effort !== 'low' || wire.store !== false
    || wire.stream !== true || JSON.stringify(wire.stream_options) !== '{"include_usage":true}'
    || !Number.isSafeInteger(wire.max_completion_tokens) || wire.max_completion_tokens < 1
    || wire.max_completion_tokens > 8192 || wire.messages?.length !== 2) reject();
  const [developer,user] = wire.messages;
  if (developer.role !== 'developer' || typeof developer.content !== 'string' || Object.keys(developer).length !== 2
    || user.role !== 'user' || Object.keys(user).length !== 2 || !Array.isArray(user.content)) reject();
  const [task,...images] = user.content;
  if (task?.type !== 'text' || typeof task.text !== 'string' || Object.keys(task).length !== 2
    || images.length < 1 || images.length > 4) reject();
  let inputUpper = Buffer.byteLength(developer.content) + Buffer.byteLength(task.text);
  for (const image of images) {
    if (image.type !== 'image_url' || Object.keys(image).length !== 2
      || image.image_url?.detail !== 'high' || Object.keys(image.image_url).length !== 2) reject();
    const match = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.image_url.url);
    if (!match || match[2]!.length > 8*1024*1024) reject();
    const bytes = Buffer.from(match![2]!, 'base64');
    if (bytes.toString('base64') !== match![2]) reject();
    const decoder = sharp(bytes, {limitInputPixels:16_000_000}).timeout({seconds:5});
    try {
      const m = await decoder.metadata();
      if (m.format !== match![1] || !m.width || !m.height || (m.pages ?? 1) !== 1 || m.width*m.height > 16_000_000) reject();
      inputUpper += Math.ceil(Math.min(2500, Math.ceil(m.width!/32)*Math.ceil(m.height!/32))*1.2);
    } finally { decoder.destroy(); }
  }
  // Explicit risk allowance: 25% on content plus 4096 framing tokens. Not an exact counter.
  inputUpper = Math.ceil(inputUpper * 1.25) + 4096;
  const outputUpper: number = wire.max_completion_tokens;
  if (inputUpper+outputUpper > 1_050_000) reject();
  const standard = estimateModelCostMicros(pricingJSON,'openai:gpt-6-astra',inputUpper,outputUpper);
  const fast = fastReview ? estimateModelCostMicros(pricingJSON,'openai:gpt-6-astra:fast',inputUpper,outputUpper) : 0;
  if (standard === undefined || fast === undefined) reject();
  // The common estimator rounds for reporting; round upward for a reservation.
  const micros = standard! + fast! + (fastReview ? 2 : 1);
  if (!Number.isSafeInteger(micros) || micros <= 0) reject();
  return {micros,inputUpper,outputUpper};
}
